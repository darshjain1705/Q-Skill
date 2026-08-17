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

from gating import StaticCombiner


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
    """Template. Replace the body with your own routing algorithm.

    Interface contract -- keep these three methods and their signatures
    and the evaluation harness will pick your algorithm up automatically:

        fit(state_vector, expert_preds, y_true)  -> self
        predict_weights(state_vector)            -> (n, n_experts), rows sum to 1
        combine(state_vector, expert_preds)      -> (predictions, weights)

    `state_vector` is a DataFrame of market-state features (volatility,
    Hurst, trailing expert errors, and -- in the routing conditions --
    inventory pressure). `expert_preds` during fit are OUT-OF-FOLD
    predictions; do not replace them with in-sample ones, that is the bug
    that broke the original project.

    ---------------------------------------------------------------
    THREE DIRECTIONS WORTH CONSIDERING
    ---------------------------------------------------------------

    1. CONFIDENCE-WEIGHTED SHRINKAGE  (recommended starting point)
       Route hard when sure, fall back to static weights when not:

           w = lambda(c) * w_regime  +  (1 - lambda(c)) * w_static

       where c is classifier confidence. The evidence says routing at
       full strength on a near-coin-flip is worse than not routing, so
       lambda should go to 0 as accuracy approaches `p_star` from
       `routing_economics`. Deriving lambda from that break-even rather
       than hand-tuning it is what turns a heuristic into an algorithm.

    2. PERSISTENCE-AWARE REGIME ESTIMATION
       Pointwise classification discards the fact that regimes last for
       weeks. Options: `smooth_labels_hysteresis` above; a hidden Markov
       filter that carries a transition matrix; or a sequential test that
       accumulates evidence and only switches when it crosses a
       threshold. Any of these should raise effective accuracy without
       needing a better classifier.

    3. LOSS-ALIGNED REGIME CLASSIFICATION
       A standard classifier maximises accuracy, treating all mistakes as
       equal. They are not: confusing regime A for B may cost far more
       than the reverse, depending on how different the experts' errors
       are. Weight the classifier's training samples by how much the
       routing decision actually matters at that timestep -- i.e. by the
       spread in expert errors. Cheap to implement, and the argument for
       it is strong.

    Combining 1 and 2 into one named method makes a coherent, presentable
    contribution. Do NOT do all three at once -- add one mechanism at a
    time and keep the ablation, or you will not know which part worked.
    """

    def __init__(self, **params):
        # Put your hyperparameters here. Keep them named and explicit so
        # they end up in the paper's reproducibility section.
        self.params = params
        self.static_ = None
        self.n_experts = None

    # -----------------------------------------------------------------
    def fit(self, state_vector: pd.DataFrame, expert_preds: np.ndarray,
            y_true: np.ndarray):
        """Learn your routing policy.

        Available to you here:
          - state_vector : market-state features (DataFrame)
          - expert_preds : OUT-OF-FOLD expert predictions (n, n_experts)
          - y_true       : realised targets (n,)

        You do NOT get regime labels. Real data has none -- that is the
        whole difficulty. You must either infer regimes (cluster the
        expert-error patterns, fit a Markov-switching model, threshold a
        signal) or route without ever naming them.
        """
        expert_preds = np.asarray(expert_preds, dtype=float)
        self.n_experts = expert_preds.shape[1]
        self.static_ = StaticCombiner().fit(expert_preds, y_true)

        # ================= YOUR CODE STARTS HERE =====================
        # Placeholder: pure static combination, no routing at all.
        # This is the bar you must clear. Delete it and write your method.
        # =============================================================
        return self

    # -----------------------------------------------------------------
    def predict_weights(self, state_vector: pd.DataFrame) -> np.ndarray:
        """Return one weight vector per row. Non-negative, rows sum to 1."""
        n = len(state_vector)

        # ================= YOUR CODE STARTS HERE =====================
        weights = np.tile(self.static_.weights_, (n, 1))
        # =============================================================

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
