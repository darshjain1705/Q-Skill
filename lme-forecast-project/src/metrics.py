"""
Forecast evaluation metrics for the return-target setting.

WHY THIS MODULE EXISTS: the original pipeline evaluated MAE on price
*levels*, which makes every comparison a proxy for "how closely did you
copy yesterday's price". On levels the random walk wins by construction
and the reported margins say nothing about forecasting skill. The
forecasting literature evaluates skill *relative to* the random walk, on
returns, with a significance test attached -- that is what this module
provides.

Three things here that the level-based evaluation could not express:

  * `rel_mae` / `mase`  -- skill scaled against the naive benchmark, so a
    number below 1.0 means "better than a random walk" and the magnitude
    is interpretable across metals with different price scales.
  * `diebold_mariano`   -- tests whether a loss difference between two
    forecasts is distinguishable from zero, with the Harvey small-sample
    correction. Without this, sub-1% MAE deltas get reported as findings.
  * `directional_accuracy` -- handles the abstention case honestly. A
    random-walk forecast of "zero return" expresses no direction; scoring
    it as a wrong direction (the old behaviour, which produced DirAcc =
    0.008) makes the baseline look absurd rather than strong.
"""
from dataclasses import dataclass

import numpy as np
from scipy import stats


# ---------------------------------------------------------------------
# Scale-free accuracy
# ---------------------------------------------------------------------

def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred))))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((np.asarray(y_true) - np.asarray(y_pred)) ** 2)))


def rel_mae(y_true: np.ndarray, y_pred: np.ndarray, y_bench: np.ndarray) -> float:
    """MAE of the forecast divided by MAE of a benchmark forecast.

    < 1.0 means the forecast beats the benchmark. This is the headline
    number a reviewer looks for, and it is the one the original pipeline
    could not report because it had no benchmark-relative view.
    """
    denom = mae(y_true, y_bench)
    if denom == 0:
        return float("nan")
    return mae(y_true, y_pred) / denom


def mase(y_true: np.ndarray, y_pred: np.ndarray, y_train: np.ndarray,
         seasonality: int = 1) -> float:
    """Mean Absolute Scaled Error (Hyndman & Koehler).

    Scaled by the in-sample one-step naive error, so it is comparable
    across series and across metals. Uses the TRAINING series for the
    scale factor -- using the test series would leak.
    """
    y_train = np.asarray(y_train)
    if len(y_train) <= seasonality:
        return float("nan")
    scale = np.mean(np.abs(y_train[seasonality:] - y_train[:-seasonality]))
    if scale == 0:
        return float("nan")
    return mae(y_true, y_pred) / scale


# ---------------------------------------------------------------------
# Direction
# ---------------------------------------------------------------------

@dataclass
class DirectionalResult:
    accuracy: float      # accuracy over the timesteps where a direction was expressed
    decision_rate: float # fraction of timesteps where the forecast expressed a direction
    n_decided: int

    def __repr__(self) -> str:
        return (f"DirectionalResult(accuracy={self.accuracy:.4f}, "
                f"decision_rate={self.decision_rate:.4f}, n_decided={self.n_decided})")


def directional_accuracy(y_true: np.ndarray, y_pred: np.ndarray,
                         tol: float = 0.0) -> DirectionalResult:
    """Directional accuracy with explicit abstention handling.

    A forecast of (approximately) zero return expresses no view on
    direction. Counting that as a miss is what drove the original
    pipeline's naive-baseline DirAcc to 0.008 -- a number that describes
    the metric, not the model. Here such timesteps are treated as
    abstentions: excluded from the accuracy, but reported via
    `decision_rate` so a model cannot look accurate by abstaining
    constantly.

    Timesteps where the *realised* return is exactly zero are also
    excluded, since there is no direction to get right.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)

    decided = np.abs(y_pred) > tol
    resolvable = decided & (y_true != 0)

    n_decided = int(resolvable.sum())
    if n_decided == 0:
        return DirectionalResult(float("nan"), 0.0, 0)

    hit = np.sign(y_pred[resolvable]) == np.sign(y_true[resolvable])
    return DirectionalResult(
        accuracy=float(hit.mean()),
        decision_rate=float(decided.mean()),
        n_decided=n_decided,
    )


# ---------------------------------------------------------------------
# Significance
# ---------------------------------------------------------------------

@dataclass
class DMResult:
    statistic: float
    p_value: float
    mean_loss_diff: float
    better: str

    def __repr__(self) -> str:
        return (f"DMResult(stat={self.statistic:.3f}, p={self.p_value:.4f}, "
                f"better={self.better})")


def diebold_mariano(y_true: np.ndarray, pred_a: np.ndarray, pred_b: np.ndarray,
                    horizon: int = 1, power: int = 1,
                    label_a: str = "A", label_b: str = "B") -> DMResult:
    """Diebold-Mariano test of equal predictive accuracy, Harvey-corrected.

    Tests H0: forecasts A and B have equal expected loss. `power=1` gives
    an absolute-error loss (matches MAE reporting), `power=2` squared error.

    The variance of the loss differential is estimated with a Newey-West
    style correction using horizon-1 lags, which for one-step forecasts
    reduces to the plain sample variance. The Harvey/Leybourne/Newbold
    small-sample correction is applied and the statistic referred to a
    t-distribution -- important here, because a semester project's test
    folds are short enough that the asymptotic normal approximation is
    optimistic.

    This is the test that turns "MAE moved by 0.48" into either a result
    or a non-result.
    """
    y_true = np.asarray(y_true, dtype=float)
    loss_a = np.abs(y_true - np.asarray(pred_a, dtype=float)) ** power
    loss_b = np.abs(y_true - np.asarray(pred_b, dtype=float)) ** power

    d = loss_a - loss_b
    d = d[np.isfinite(d)]
    n = len(d)
    if n < 8:
        return DMResult(float("nan"), float("nan"), float(np.mean(d) if n else np.nan), "undetermined")

    d_bar = float(np.mean(d))

    # Long-run variance with horizon-1 autocovariance lags.
    gamma0 = float(np.mean((d - d_bar) ** 2))
    lrv = gamma0
    for lag in range(1, horizon):
        cov = float(np.mean((d[lag:] - d_bar) * (d[:-lag] - d_bar)))
        lrv += 2.0 * cov
    if lrv <= 0:
        return DMResult(float("nan"), float("nan"), d_bar, "undetermined")

    dm = d_bar / np.sqrt(lrv / n)

    # Harvey, Leybourne & Newbold (1997) small-sample correction.
    correction = np.sqrt((n + 1 - 2 * horizon + horizon * (horizon - 1) / n) / n)
    dm *= correction

    p = 2 * (1 - stats.t.cdf(abs(dm), df=n - 1))

    if not np.isfinite(p):
        better = "undetermined"
    elif p >= 0.05:
        better = "no difference"
    else:
        better = label_b if d_bar > 0 else label_a

    return DMResult(float(dm), float(p), d_bar, better)


# ---------------------------------------------------------------------
# Gate behaviour diagnostics
# ---------------------------------------------------------------------

def weight_entropy(weights: np.ndarray, normalize: bool = True) -> np.ndarray:
    """Per-timestep Shannon entropy of the gate's weight vector.

    Normalized to [0, 1] where 1 = uniform (the gate is not choosing) and
    0 = one-hot (the gate has fully committed to one expert). This is the
    direct diagnostic for the failure the audit found: a gate that emits
    a near-constant near-uniform vector has entropy pinned near 1 with no
    variance, whatever its MAE happens to be.
    """
    w = np.clip(np.asarray(weights, dtype=float), 1e-12, None)
    w = w / w.sum(axis=1, keepdims=True)
    h = -np.sum(w * np.log(w), axis=1)
    if normalize:
        h = h / np.log(w.shape[1])
    return h


def effective_experts(weights: np.ndarray) -> np.ndarray:
    """exp(entropy) -- the effective number of experts in play at each step.

    Reads more intuitively than entropy in a paper: "the gate used 1.2 of
    4 available experts on average" is a sentence a reviewer can check.
    """
    return np.exp(weight_entropy(weights, normalize=False))


def routing_agreement(weights: np.ndarray, expert_errors: np.ndarray) -> float:
    """Fraction of timesteps where the gate's top-weighted expert is the
    one that actually turned out to have the lowest error.

    This is the cleanest single test of whether routing *works*, and it is
    independent of whether the combined forecast happens to beat a
    benchmark. A gate can improve MAE by accidental shrinkage while
    routing no better than chance; this separates the two.
    """
    chosen = np.argmax(np.asarray(weights), axis=1)
    best = np.argmin(np.abs(np.asarray(expert_errors)), axis=1)
    return float(np.mean(chosen == best))


def weight_dispersion(weights: np.ndarray) -> dict:
    """Summary of how much the gate's weights actually move over time.

    `std_over_time` near zero means the gate is a static combiner wearing
    a dynamic architecture's clothes -- exactly the condition the audit
    found in the original implementation.
    """
    w = np.asarray(weights, dtype=float)
    return {
        "mean": w.mean(axis=0),
        "std_over_time": w.std(axis=0),
        "range": w.max(axis=0) - w.min(axis=0),
        "mean_entropy": float(weight_entropy(w).mean()),
        "mean_effective_experts": float(effective_experts(w).mean()),
    }
