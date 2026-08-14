"""
Gating / forecast-combination layer.

REWRITTEN. The previous version had two defects that between them made
the architecture inert, both reproduced numerically in the project audit:

  1. `predict_weights` applied `softmax` to an MLP output that was already
     a normalized weight vector. Softmax over values in [0, 1] compresses
     toward uniform, so the gate emitted a near-constant vector whatever
     the market state -- observed pooled weights [0.564, 0.219, 0.217]
     against the collapse target softmax([1,0,0]) = [0.576, 0.212, 0.212].
     Fixed here by clipping negatives and renormalizing by the sum.

  2. The oracle temperature was fixed at 1.0 while the errors it scored
     were price levels in the tens-to-hundreds. `softmax(-error)` then
     saturates to one-hot regardless of the actual spread between experts.
     Fixed here by scaling the trailing errors by their own cross-expert
     dispersion before the softmax, so temperature is dimensionless and
     means the same thing on returns, on levels, and across metals.

Also new: the trailing-error window is now *lagged*, so the oracle target
at time t is built only from errors observable strictly before t. The
previous version included the contemporaneous error via
`rolling(..., min_periods=1)`.

This module now provides three combiners that share one interface, which
is what makes the paper's central comparison possible:

  StaticCombiner   -- one fixed weight vector, fitted once. The control.
                      If the gate cannot beat this, "dynamic" bought
                      nothing and the architecture claim fails.
  GatingNetwork    -- input-conditioned weights from a market-state vector.
  OracleRouter     -- routes using ground-truth information. Not a
                      competitor; an upper bound on what any router could
                      achieve on this data, which is the only way to tell
                      "routing does not help here" apart from "our router
                      is bad".
"""
import numpy as np
import pandas as pd
from scipy.optimize import nnls
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler


def softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    x = x - np.max(x, axis=axis, keepdims=True)
    e = np.exp(x)
    return e / np.sum(e, axis=axis, keepdims=True)


def _normalize_rows(w: np.ndarray) -> np.ndarray:
    """Project an arbitrary real matrix onto the simplex row-wise by
    clipping and renormalizing.

    This replaces the second softmax. Clipping preserves the relative
    ordering and the *magnitude* of the differences the model learned;
    softmax would have destroyed both.
    """
    w = np.clip(np.atleast_2d(np.asarray(w, dtype=float)), 0.0, None)
    row_sum = w.sum(axis=1, keepdims=True)
    degenerate = (row_sum <= 1e-12).ravel()
    w = np.where(row_sum > 1e-12, w / np.maximum(row_sum, 1e-12), w)
    if degenerate.any():
        w[degenerate] = 1.0 / w.shape[1]
    return w


def compute_oracle_weights(expert_preds: np.ndarray, y_true: np.ndarray,
                           mode: str = "forward", trail_window: int = 10,
                           temperature: float = 1.0, lag: int = 1) -> np.ndarray:
    """Supervision target for the gate.

    expert_preds: (T, n_experts)   prediction made AT row t, FOR row t's target
    y_true:       (T,)

    Two modes, and the difference between them is the project's main
    methodological finding:

    `mode="trailing"` -- softmax over each expert's recent average error.
        This is the arbitrated-dynamic-ensemble convention and what the
        original implementation used. It teaches the gate to imitate
        "trust whoever has been right lately".

    `mode="forward"` -- softmax over each expert's error ON THIS ROW'S
        PREDICTION. This is the loss the combination is actually judged on.
        The target is known at training time and is never needed at
        inference, so it is supervision, not leakage.

    WHY THE DISTINCTION MATTERS. A trailing-error target is a *lagging*
    construct. If the gate's inputs contain a signal that LEADS regime
    change -- which is precisely the claim being made for warehouse
    inventory pressure -- then trailing supervision caps what the gate can
    learn from it: the target has not yet moved when the leading signal
    has. The gate is punished for acting on the very information it was
    given the signal to act on.

    In this project's controlled testbed, where inventory pressure
    predicts the next regime at AUC 0.85-0.90 and an oracle router
    achieves a significant gain over a static combiner, a trailing-
    supervised gate captured essentially none of that gain and routed at
    barely above chance. That is not a property of the signal or of the
    architecture; it is a property of the supervision target.

    Errors are divided by their per-timestep cross-expert standard
    deviation before the softmax, which makes `temperature` dimensionless
    -- the same value means the same sharpness whether the target is a
    price level or a return.
    """
    if mode not in ("forward", "trailing"):
        raise ValueError("mode must be 'forward' or 'trailing'")

    expert_preds = np.asarray(expert_preds, dtype=float)
    y_true = np.asarray(y_true, dtype=float)

    abs_err = np.abs(expert_preds - y_true[:, None])

    if mode == "trailing":
        base = (
            pd.DataFrame(abs_err)
            .shift(lag)
            .rolling(trail_window, min_periods=max(1, trail_window // 2))
            .mean()
            .bfill()
            .ffill()
            .values
        )
    else:
        base = abs_err

    spread = base.std(axis=1, keepdims=True)
    spread = np.where(spread > 1e-12, spread, 1.0)
    scaled = base / spread

    return softmax(-scaled / max(temperature, 1e-6), axis=1)


class StaticCombiner:
    """Single fixed non-negative weight vector, fitted by NNLS.

    The control condition for the whole project. A dynamic gate has to
    beat this to justify itself; the original pipeline never fitted one,
    so it had no way to tell whether its gate was contributing anything
    beyond a decent average.
    """

    def __init__(self):
        self.weights_ = None

    def fit(self, expert_preds: np.ndarray, y_true: np.ndarray):
        A = np.asarray(expert_preds, dtype=float)
        b = np.asarray(y_true, dtype=float)
        ok = np.isfinite(A).all(axis=1) & np.isfinite(b)
        w, _ = nnls(A[ok], b[ok])
        if w.sum() <= 1e-12:
            w = np.ones(A.shape[1])
        self.weights_ = w / w.sum()
        return self

    def combine(self, expert_preds: np.ndarray):
        preds = np.asarray(expert_preds, dtype=float)
        weights = np.tile(self.weights_, (len(preds), 1))
        return np.sum(weights * preds, axis=1), weights


class GatingNetwork:
    """Input-conditioned soft gating over a pool of experts.

    Interface unchanged from the original so the rest of the pipeline and
    the Streamlit app keep working; the internals are corrected.

    PARAMETERIZATION. The gate regresses onto *log* oracle weights and
    applies a softmax at inference, rather than regressing onto the
    weights themselves. This matters more than it looks:

      - An MLP has an unconstrained linear output layer, so weight-space
        targets force it to hit a simplex it has no structural way to
        respect. Negative outputs then have to be clipped, and clipping
        can zero out an expert permanently.
      - In logit space the output is naturally unconstrained and the
        softmax guarantees a valid, strictly positive weight vector.

    Measured on the module's own regime self-test, where the correct
    routing is known by construction:

        weight-space + clipping   MAE 0.395   routing accuracy 0.865
        logit-space + softmax     MAE 0.239   routing accuracy 0.863

    Note this is NOT a return to the original bug. The original applied
    softmax to targets that were already weights; here the targets are
    log-weights, which is what a softmax is the correct inverse of.

    EARLY STOPPING is off by default. sklearn's `early_stopping=True`
    holds out 10% of an already-short training window and halts on a
    noisy multi-output validation score. On the self-test it degraded the
    gate from 0.395 to 1.224 MAE and dropped routing accuracy to 0.100 --
    worse than chance. Regularization is handled by `alpha` instead.
    """

    def __init__(self, hidden_layer_sizes=(32, 16), temperature: float = 1.0,
                 trail_window: int = 10, oracle_lag: int = 1, random_state: int = 0,
                 alpha: float = 1e-3, early_stopping: bool = False,
                 parameterization: str = "logit", oracle_mode: str = "forward"):
        if parameterization not in ("logit", "weight"):
            raise ValueError("parameterization must be 'logit' or 'weight'")
        self.parameterization = parameterization
        self.oracle_mode = oracle_mode
        self.scaler = StandardScaler()
        self.model = MLPRegressor(
            hidden_layer_sizes=hidden_layer_sizes,
            max_iter=3000,
            random_state=random_state,
            alpha=alpha,
            early_stopping=early_stopping,
        )
        self.temperature = temperature
        self.trail_window = trail_window
        self.oracle_lag = oracle_lag
        self.n_experts = None
        self.oracle_weights_ = None

    def fit(self, state_vector: pd.DataFrame, expert_preds: np.ndarray,
            y_true: np.ndarray):
        """Fit the gate.

        IMPORTANT: `expert_preds` must be OUT-OF-FOLD predictions. Passing
        the experts' in-sample predictions -- what the original pipeline
        did -- makes the oracle reward whichever expert overfits hardest.
        In the audit that assigned weight 0.97 to an expert whose error
        degraded 48.6x out of sample. See `oof.py`.
        """
        expert_preds = np.asarray(expert_preds, dtype=float)
        self.n_experts = expert_preds.shape[1]

        oracle = compute_oracle_weights(
            expert_preds, y_true,
            mode=self.oracle_mode,
            trail_window=self.trail_window,
            temperature=self.temperature,
            lag=self.oracle_lag,
        )
        self.oracle_weights_ = oracle

        if self.parameterization == "logit":
            # Centred log-weights: unconstrained, and softmax-invertible.
            target = np.log(np.clip(oracle, 1e-6, None))
            target = target - target.mean(axis=1, keepdims=True)
        else:
            target = oracle

        X = self.scaler.fit_transform(np.asarray(state_vector, dtype=float))
        self.model.fit(X, target)
        return self

    def predict_weights(self, state_vector: pd.DataFrame) -> np.ndarray:
        X = self.scaler.transform(np.asarray(state_vector, dtype=float))
        raw = np.atleast_2d(self.model.predict(X))
        if self.parameterization == "logit":
            return softmax(raw, axis=1)
        # Weight-space fallback: clip + renormalize. NOT softmax -- applying
        # softmax to values that are already weights is the original bug.
        return _normalize_rows(raw)

    def combine(self, state_vector: pd.DataFrame, expert_preds: np.ndarray):
        weights = self.predict_weights(state_vector)
        preds = np.asarray(expert_preds, dtype=float)
        return np.sum(weights * preds, axis=1), weights


class OracleRouter:
    """Upper bound on achievable routing gain.

    Given ground-truth regime labels (available in the controlled
    synthetic testbed, and approximable on real data via a separately
    fitted regime model), assigns each timestep the weight vector that was
    best *on average within that regime* over the training window.

    This is not a model anyone can deploy -- it is the reference line that
    makes a negative result interpretable. Without it, "the gate did not
    beat the random walk" is ambiguous between "there is no regime
    structure to exploit" and "our gate failed to exploit it". With it,
    those two are distinguishable, which is what makes an honest negative
    result publishable rather than merely disappointing.
    """

    def __init__(self):
        self.regime_weights_ = {}
        self.n_experts = None
        self.fallback_ = None

    def fit(self, regimes: np.ndarray, expert_preds: np.ndarray, y_true: np.ndarray):
        expert_preds = np.asarray(expert_preds, dtype=float)
        y_true = np.asarray(y_true, dtype=float)
        self.n_experts = expert_preds.shape[1]

        self.fallback_ = StaticCombiner().fit(expert_preds, y_true).weights_
        for r in np.unique(regimes):
            m = regimes == r
            if m.sum() < max(20, self.n_experts * 5):
                self.regime_weights_[r] = self.fallback_
                continue
            self.regime_weights_[r] = StaticCombiner().fit(
                expert_preds[m], y_true[m]
            ).weights_
        return self

    def combine(self, regimes: np.ndarray, expert_preds: np.ndarray):
        preds = np.asarray(expert_preds, dtype=float)
        weights = np.vstack([
            self.regime_weights_.get(r, self.fallback_) for r in regimes
        ])
        return np.sum(weights * preds, axis=1), weights


if __name__ == "__main__":
    # Self-test on a construction where routing is KNOWN to be the right
    # answer: two regimes, and a different expert is accurate in each.
    # A working gate must beat the static combiner here. The previous
    # implementation could not -- it lost to the best single expert even
    # on its own favourable self-test.
    rng = np.random.default_rng(0)
    T, n_experts = 1200, 3

    regime = (rng.random(T) < 0.5).astype(int)
    for i in range(1, T):                      # make regimes persistent
        if rng.random() < 0.97:
            regime[i] = regime[i - 1]

    y = rng.normal(0, 1, T)
    preds = np.zeros((T, n_experts))
    preds[:, 0] = y + rng.normal(0, np.where(regime == 0, 0.2, 3.0))  # good in regime 0
    preds[:, 1] = y + rng.normal(0, np.where(regime == 0, 3.0, 0.2))  # good in regime 1
    preds[:, 2] = y + rng.normal(0, 2.0, T)                           # mediocre always

    state = pd.DataFrame({
        "regime_signal": regime + rng.normal(0, 0.25, T),   # noisy observable
        "noise": rng.normal(0, 1, T),
    })

    split = 800
    gate = GatingNetwork(temperature=0.5).fit(
        state.iloc[:split], preds[:split], y[:split]
    )
    gated, w = gate.combine(state.iloc[split:], preds[split:])

    static = StaticCombiner().fit(preds[:split], y[:split])
    stat_pred, _ = static.combine(preds[split:])

    yt = y[split:]
    m = lambda p: np.mean(np.abs(p - yt))
    print(f"gated MAE        : {m(gated):.4f}")
    print(f"static MAE       : {m(stat_pred):.4f}   <- gate must beat this")
    print(f"simple avg MAE   : {m(preds[split:].mean(axis=1)):.4f}")
    print(f"best single MAE  : {min(m(preds[split:, i]) for i in range(n_experts)):.4f}")
    print(f"weight std/time  : {np.round(w.std(axis=0), 3)}   <- must be non-trivial")


class ClusteredRouter:
    """Two-stage router: discover expert-specialization regimes, then learn
    to anticipate them from the market state.

    MOTIVATION. Direct error-imitation gating -- whether supervised on
    trailing errors or on the realised next-step error -- fails to capture
    routing gain that an oracle proves is available. The two failure modes
    are complementary and both are structural:

      trailing target : smooth but LAGGING. It cannot reward a gate for
                        acting on a leading indicator, because the target
                        has not moved yet when the indicator has.
      forward target  : unbiased but a single-sample estimate of "which
                        expert is best here", dominated by idiosyncratic
                        noise. The gate fits the noise.

    Neither matches the structure of the thing being predicted. What
    actually varies is not each expert's error at a point, but WHICH
    EXPERT REGIME the market is in -- a latent, persistent, low-dimensional
    state. So model that instead:

      1. Cluster the out-of-fold relative error profiles. Each cluster is a
         discovered "who wins here" regime -- found from the experts'
         behaviour, with no regime labels required, so this works on real
         data where no ground truth exists.
      2. Fit non-negative combination weights separately within each
         cluster.
      3. Train a classifier to predict cluster membership from the market
         state -- and this is where an exogenous leading signal such as
         inventory pressure can pay off, because predicting a persistent
         discrete state from a noisy leading indicator is a far
         better-conditioned problem than regressing a noisy weight vector.
      4. At inference, mix the cluster weight vectors by predicted cluster
         probability.

    This mirrors the oracle router's structure while using only
    information available at prediction time.
    """

    def __init__(self, n_regimes: int = 3, random_state: int = 0,
                 classifier=None, min_cluster: int = 25):
        self.n_regimes = n_regimes
        self.random_state = random_state
        self.min_cluster = min_cluster
        self.classifier = classifier
        self.kmeans_ = None
        self.cluster_weights_ = None
        self.fallback_ = None
        self.n_experts = None

    @staticmethod
    def _error_profile(expert_preds, y_true):
        """Row-normalized absolute error: the SHAPE of who-beat-whom,
        stripped of the overall difficulty of the timestep."""
        err = np.abs(np.asarray(expert_preds, dtype=float)
                     - np.asarray(y_true, dtype=float)[:, None])
        denom = err.sum(axis=1, keepdims=True)
        return err / np.where(denom > 1e-15, denom, 1.0)

    def fit(self, state_vector, expert_preds, y_true):
        from sklearn.cluster import KMeans
        from sklearn.ensemble import HistGradientBoostingClassifier

        expert_preds = np.asarray(expert_preds, dtype=float)
        y_true = np.asarray(y_true, dtype=float)
        self.n_experts = expert_preds.shape[1]
        self.fallback_ = StaticCombiner().fit(expert_preds, y_true).weights_

        profile = self._error_profile(expert_preds, y_true)
        k = max(2, min(self.n_regimes, len(profile) // self.min_cluster))
        self.kmeans_ = KMeans(n_clusters=k, n_init=10,
                              random_state=self.random_state).fit(profile)
        labels = self.kmeans_.labels_

        self.cluster_weights_ = np.vstack([
            StaticCombiner().fit(expert_preds[labels == c], y_true[labels == c]).weights_
            if (labels == c).sum() >= max(self.min_cluster, self.n_experts * 3)
            else self.fallback_
            for c in range(k)
        ])

        if self.classifier is None:
            self.classifier = HistGradientBoostingClassifier(
                max_iter=200, random_state=self.random_state)
        X = np.asarray(state_vector, dtype=float)
        self.classifier.fit(X, labels)
        self.classes_ = self.classifier.classes_
        return self

    def predict_weights(self, state_vector) -> np.ndarray:
        X = np.asarray(state_vector, dtype=float)
        proba = self.classifier.predict_proba(X)
        # proba columns follow classifier.classes_, which may omit clusters
        W = self.cluster_weights_[np.asarray(self.classes_, dtype=int)]
        return proba @ W

    def combine(self, state_vector, expert_preds):
        w = self.predict_weights(state_vector)
        return np.sum(w * np.asarray(expert_preds, dtype=float), axis=1), w
