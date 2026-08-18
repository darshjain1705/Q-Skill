"""
YOUR ALGORITHM GOES HERE.

=====================================================================
THE PROBLEM THIS FILE EXISTS TO SOLVE
=====================================================================

The experiments in `experiment.py` establish three things:

  1. Regime-conditional combination beats a static weight vector by
     2.0% (zinc) and 3.5% (aluminium), significantly -- IF you know the
     regime. There is real gain available.

  2. A realistic regime classifier reaches 67.5% (zinc) / 80.5%
     (aluminium) accuracy using the inventory-pressure signal.

  3. At that accuracy only 13-35% of the gain survives, and BELOW about
     60% accuracy routing is actively WORSE than not routing at all.

Finding 3 is an unsolved problem, and it is stated precisely enough to
attack. Every existing router in this codebase routes at full strength
regardless of how sure it is. That is the gap your algorithm should fill.

=====================================================================
WHAT "YOUR OWN ALGORITHM" MEANS HERE
=====================================================================

Not inventing something from nothing. It means:

  (a) naming a specific failure mode -- done for you above,
  (b) proposing a specific mechanism that should fix it,
  (c) arguing why it should work BEFORE you run it,
  (d) implementing it,
  (e) testing it against controls you cannot game.

Steps (a) and (e) are provided. (b), (c), (d) are yours -- and those are
the parts that make it your contribution.

=====================================================================
HOW TO USE THIS FILE
=====================================================================

    1. Edit `MyRouter.fit` and `MyRouter.predict_weights` below.
    2. Run:  python evaluate_my_algorithm.py
    3. Read the verdict. Iterate.

The class ships as a pass-through to StaticCombiner so the harness runs
before you write anything. Your job is to beat that.
"""
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

from gating import ClusteredRouter, StaticCombiner


# =====================================================================
# INFRASTRUCTURE -- use this to design, do not treat it as the answer
# =====================================================================

def routing_economics(expert_preds: np.ndarray, y_true: np.ndarray,
                      regimes: np.ndarray) -> dict:
    """Measure the economics of routing on a given dataset.

    Answers the question your algorithm must respect: HOW ACCURATE does a
    regime classifier have to be before routing is worth doing at all?

    Define three reference losses:

        A = loss when you always route CORRECTLY   (oracle)
        B = loss when you always route INCORRECTLY (anti-oracle)
        S = loss of a single static weight vector  (no routing)

    A router that is correct with probability p has expected loss
    p*A + (1-p)*B. It beats static when

        p*A + (1-p)*B  <  S
        =>   p  >  (B - S) / (B - A)   =:  p_star

    p_star is the break-even accuracy. Note it is NOT 0.5: a good static
    weight vector sits much closer to A than to B, which pushes p_star
    well above a coin flip. That is the arithmetic behind the empirical
    "~60%" threshold in the results, and deriving it is a genuine (small)
    theoretical contribution you can put in the paper.

    Returns A, B, S and p_star. Currently implemented for 2 regimes.
    """
    expert_preds = np.asarray(expert_preds, dtype=float)
    y_true = np.asarray(y_true, dtype=float)
    regimes = np.asarray(regimes)
    labels = np.unique(regimes)
    if len(labels) != 2:
        raise NotImplementedError("routing_economics currently assumes 2 regimes")

    # regime-specific optimal weights, fitted per regime
    w = {}
    for r in labels:
        m = regimes == r
        w[r] = StaticCombiner().fit(expert_preds[m], y_true[m]).weights_

    def loss_with(weight_lookup):
        pred = np.array([
            expert_preds[i] @ weight_lookup(regimes[i]) for i in range(len(y_true))
        ])
        return float(np.mean(np.abs(pred - y_true)))

    other = {labels[0]: labels[1], labels[1]: labels[0]}
    A = loss_with(lambda r: w[r])
    B = loss_with(lambda r: w[other[r]])
    S = float(np.mean(np.abs(
        expert_preds @ StaticCombiner().fit(expert_preds, y_true).weights_ - y_true)))

    p_star = (B - S) / (B - A) if B > A else np.nan
    return {"A_oracle": A, "B_anti_oracle": B, "S_static": S,
            "p_star_breakeven_accuracy": p_star,
            "available_gain_pct": (S - A) / S * 100}


def confidence_from_proba(proba: np.ndarray, method: str = "margin") -> np.ndarray:
    """Turn class probabilities into a scalar confidence in [0, 1].

    Three options, because which one you pick is a real design decision
    and they behave differently:

      "max"     -- the highest class probability. Simple; for 2 classes it
                   is bounded below by 0.5, so rescale if you want [0,1].
      "margin"  -- gap between top two probabilities. Directly measures
                   how close the decision was.
      "entropy" -- 1 minus normalized entropy. Uses the whole distribution,
                   which matters if you ever go beyond 2 regimes.

    Justify your choice in the write-up rather than picking silently.
    """
    p = np.clip(np.asarray(proba, dtype=float), 1e-12, 1.0)
    p = p / p.sum(axis=1, keepdims=True)
    if method == "max":
        return p.max(axis=1)
    if method == "margin":
        s = np.sort(p, axis=1)
        return s[:, -1] - s[:, -2]
    if method == "entropy":
        h = -np.sum(p * np.log(p), axis=1) / np.log(p.shape[1])
        return 1.0 - h
    raise ValueError("method must be 'max', 'margin' or 'entropy'")


def smooth_labels_hysteresis(scores: np.ndarray, enter: float = 0.65,
                             exit_: float = 0.45) -> np.ndarray:
    """Persistence-aware label smoothing (a Schmitt trigger).

    Regimes are persistent -- in the testbed they last ~50-100 days -- but
    a pointwise classifier re-decides every single day and therefore
    flickers. Every spurious flip is a routing error you pay for.

    This switches INTO regime 1 only when the score exceeds `enter`, and
    back to regime 0 only when it drops below `exit_`. The gap between the
    two thresholds is what suppresses flicker.

    Provided as a building block. Whether you use it, and how you set the
    thresholds, is your design decision -- and a defensible way to set
    them is to tune on the training window only, never on test.
    """
    scores = np.asarray(scores, dtype=float)
    out = np.zeros(len(scores), dtype=int)
    state = int(scores[0] > (enter + exit_) / 2) if len(scores) else 0
    for i, s in enumerate(scores):
        if state == 0 and s > enter:
            state = 1
        elif state == 1 and s < exit_:
            state = 0
        out[i] = state
    return out


# =====================================================================
# YOUR ALGORITHM
# =====================================================================

class MyRouter:
    """Confidence-Thresholded Cluster Router (CTCR).

    THE MECHANISM. Every other router in this codebase routes at full
    strength regardless of how sure it is. `routing_economics()` shows why
    that is costly: a router correct with probability p only beats static
    combination once p clears a break-even p_star that sits well above a
    coin flip. Below p_star, routing loses money; above it, routing pays.

    CTCR estimates, for ITS OWN classifier, the confidence level at which
    that crossing actually happens -- call it c_star -- and blends toward
    the static combiner below it:

        w(x) = lambda(c) * w_regime(x)  +  (1 - lambda(c)) * w_static
        lambda(c) = clip((c - c_star) / (1 - c_star), 0, 1)

    So lambda = 0 (pure static, no routing) at or below c_star, rising
    linearly to lambda = 1 (full routing) as confidence approaches 1.
    c_star is not hand-tuned -- it is estimated empirically for this
    dataset, this expert panel, and this classifier (see `fit` below), so
    it plays the same role that `p_star_breakeven_accuracy` plays in the
    theory, but calibrated directly on realised loss rather than derived
    from ground-truth regime labels that a real deployment never has.

    HOW REGIMES ARE FOUND. No regime labels are available -- real data has
    none. Following `ClusteredRouter`, regimes are discovered by k-means
    clustering the experts' row-normalised absolute-error profile: rows
    where the same expert tends to win end up in the same cluster. A
    classifier is then trained to predict cluster membership from the
    market-state vector, exactly as in `ClusteredRouter`. CTCR's only new
    ingredient is the confidence-based shrinkage layered on top of that.

    HOW c_star IS ESTIMATED (the calibration step, and the part worth
    reading carefully). The training window is split in TIME ORDER into
    an inner-fit slice (the first `1 - calib_frac`) and an inner-calibration
    slice (the remainder). Clusters and the classifier are fit on the
    inner-fit slice only. On the inner-calibration slice -- data the
    classifier did not see -- the realised benefit of routing at full
    strength is measured directly:

        benefit(x) = |static_pred - y| - |routed_pred - y|

    positive means routing beat static at that point. An isotonic
    (monotonic) regression of benefit against classifier confidence is
    fit on the calibration slice, and c_star is read off as the
    confidence value where that curve crosses zero. This is a direct,
    dataset-specific analogue of p_star: instead of assuming a classifier
    accuracy and looking up a break-even in theory, it measures the
    break-even this particular classifier actually achieves.

    LIMITATION, worth stating plainly rather than hiding: c_star is
    calibrated on a single time-ordered split of the training window and
    is not revisited afterwards, so it can drift stale on a very long
    deployment. A rolling recalibration is the natural next step and is
    flagged rather than implemented, to keep this version simple enough
    to defend in full.
    """

    def __init__(self, n_regimes: int = 2, calib_frac: float = 0.3,
                 confidence_method: str = "margin", min_cluster: int = 25,
                 min_train: int = 60, random_state: int = 0):
        self.n_regimes = n_regimes
        self.calib_frac = calib_frac
        self.confidence_method = confidence_method
        self.min_cluster = min_cluster
        self.min_train = min_train
        self.random_state = random_state

        self.static_ = None
        self.n_experts = None
        self.classifier_ = None
        self.cluster_weights_ = None
        self.classes_ = None
        self.c_star_ = 1.0   # 1.0 = "never fully trust the router" until calibrated

    # -----------------------------------------------------------------
    def fit(self, state_vector: pd.DataFrame, expert_preds: np.ndarray,
            y_true: np.ndarray):
        X = np.asarray(state_vector, dtype=float)
        expert_preds = np.asarray(expert_preds, dtype=float)
        y_true = np.asarray(y_true, dtype=float)
        n = len(y_true)
        self.n_experts = expert_preds.shape[1]
        self.static_ = StaticCombiner().fit(expert_preds, y_true)

        split = int(n * (1 - self.calib_frac))
        if split < self.min_train or (n - split) < self.min_train:
            # Not enough data to both fit a router and calibrate it
            # honestly. Fall back to static combination rather than
            # calibrate on too little data and trust a noisy estimate.
            self.classifier_ = None
            return self

        Xa, Xb = X[:split], X[split:]
        Ea, Eb = expert_preds[:split], expert_preds[split:]
        ya, yb = y_true[:split], y_true[split:]

        # ---- discover regimes from the error-profile shape (fit slice) --
        k = max(2, min(self.n_regimes, split // self.min_cluster))
        profile = ClusteredRouter._error_profile(Ea, ya)
        labels = KMeans(n_clusters=k, n_init=10,
                        random_state=self.random_state).fit_predict(profile)

        cluster_weights = np.vstack([
            StaticCombiner().fit(Ea[labels == c], ya[labels == c]).weights_
            if (labels == c).sum() >= max(self.min_cluster, self.n_experts * 3)
            else self.static_.weights_
            for c in range(k)
        ])
        clf = HistGradientBoostingClassifier(
            max_iter=200, random_state=self.random_state).fit(Xa, labels)

        self.classifier_ = clf
        self.cluster_weights_ = cluster_weights
        self.classes_ = clf.classes_

        # ---- calibrate c_star on the held-out calibration slice ---------
        proba_b = clf.predict_proba(Xb)
        conf_b = confidence_from_proba(proba_b, method=self.confidence_method)
        W = self.cluster_weights_[np.asarray(self.classes_, dtype=int)]
        pred_route_b = np.sum((proba_b @ W) * Eb, axis=1)
        pred_static_b = Eb @ self.static_.weights_
        benefit = np.abs(pred_static_b - yb) - np.abs(pred_route_b - yb)

        if len(conf_b) < 20 or len(np.unique(conf_b)) < 3:
            self.c_star_ = 1.0  # too little to calibrate; never fully trust it
        else:
            iso = IsotonicRegression(increasing=True, out_of_bounds="clip")
            iso.fit(conf_b, benefit)
            grid = np.linspace(conf_b.min(), conf_b.max(), 200)
            crossing = np.where(iso.predict(grid) > 0)[0]
            self.c_star_ = (float(grid[crossing[0]]) if len(crossing)
                            else float(grid[-1]) + 1e-6)
        return self

    # -----------------------------------------------------------------
    def predict_weights(self, state_vector: pd.DataFrame) -> np.ndarray:
        X = np.asarray(state_vector, dtype=float)
        n = len(X)

        if self.classifier_ is None:
            weights = np.tile(self.static_.weights_, (n, 1))
        else:
            proba = self.classifier_.predict_proba(X)
            conf = confidence_from_proba(proba, method=self.confidence_method)
            W = self.cluster_weights_[np.asarray(self.classes_, dtype=int)]
            w_route = proba @ W

            denom = max(1.0 - self.c_star_, 1e-6)
            lam = np.clip((conf - self.c_star_) / denom, 0.0, 1.0)[:, None]
            weights = lam * w_route + (1.0 - lam) * self.static_.weights_[None, :]

        weights = np.clip(np.asarray(weights, dtype=float), 0, None)
        row = weights.sum(axis=1, keepdims=True)
        return np.where(row > 1e-12, weights / np.maximum(row, 1e-12),
                        1.0 / self.n_experts)

    # -----------------------------------------------------------------
    def combine(self, state_vector: pd.DataFrame, expert_preds: np.ndarray):
        w = self.predict_weights(state_vector)
        return np.sum(w * np.asarray(expert_preds, dtype=float), axis=1), w


if __name__ == "__main__":
    # Quick look at the routing economics of the testbed -- run this
    # BEFORE designing, so you know what accuracy you have to beat.
    import warnings
    warnings.filterwarnings("ignore")
    from expert_panel import default_panel, fit_panel, panel_predict
    from featureset import CONDITIONS, build_return_features

    raw = pd.read_csv("../data/synthetic_regime_daily.csv", parse_dates=["date"])
    for metal in ("zinc", "aluminium"):
        df, spec = build_return_features(raw, metal, **CONDITIONS["both"])
        n = len(df)
        s = int(n * 0.7)
        fitted = fit_panel(default_panel(), df.iloc[:s], spec)
        idx = np.arange(s, n)
        econ = routing_economics(
            panel_predict(fitted, df, idx, spec),
            df[spec.target_col].values[idx],
            df[spec.regime_col].values[idx],
        )
        print(f"\n{metal}:")
        for k, v in econ.items():
            print(f"   {k:32s} {v:.4f}")
        print(f"   -> a router must exceed "
              f"{econ['p_star_breakeven_accuracy']:.1%} accuracy to be worth using")
