"""
Out-of-fold expert predictions for honest combiner training.

THE PROBLEM THIS SOLVES. A combiner -- static or gated -- learns how much
to trust each expert by looking at how wrong each expert has been. If it
is shown the experts' predictions on the data those experts were fitted
to, it sees memorization rather than skill, and it learns to trust
whichever expert overfits hardest.

Measured on the original pipeline (zinc, 1000/441 split):

    expert      in-sample MAE   out-of-sample MAE   degradation
    boosting        11.85            576.37            48.6x
    sequence        33.64            428.81            12.7x
    momentum        31.70             43.95             1.4x

    oracle weight given to boosting: 0.97   (worst out of sample)
    oracle weight given to momentum: 0.02   (best out of sample)

The combiner's preference ordering was exactly inverted. No amount of
tuning the gate architecture fixes that, because the supervision signal
itself is wrong.

This is not a new insight -- it is the reason stacked generalization has
required cross-validated base predictions since Wolpert (1992), and the
same requirement carries over to any learned combiner. What is worth
recording is how severe it is in the *dynamic gating* setting, where the
supervision target is a rolling function of recent errors and the
distortion therefore compounds over the whole training window rather than
averaging out.

THE FIX. Split the training window into contiguous blocks. For each
block, fit the experts on everything strictly before it and predict the
block. Blocks are contiguous and forward-only -- never shuffled k-fold --
because shuffling would let an expert train on the future of its own test
rows, which in a time series is a second leak wearing the first one's
clothes.
"""
import numpy as np
import pandas as pd

from expert_panel import fit_panel, panel_predict


def blocked_oof_predictions(panel, train_df: pd.DataFrame, spec,
                            n_blocks: int = 5, min_train_frac: float = 0.35,
                            verbose: bool = False):
    """Expanding-window out-of-fold predictions across a training window.

    Returns (oof_preds, valid_mask):
        oof_preds  -- (n_train, n_experts), NaN in the warm-up region
        valid_mask -- (n_train,) bool, True where all experts produced a
                      prediction from a model that never saw that row

    The warm-up region (the first `min_train_frac` of the window) has no
    out-of-fold prediction available by construction -- there is nothing
    earlier to fit on. Those rows are masked rather than back-filled;
    filling them would reintroduce exactly the contamination this function
    exists to remove.
    """
    n = len(train_df)
    n_experts = len(panel)
    oof = np.full((n, n_experts), np.nan)

    warmup = int(n * min_train_frac)
    remaining = n - warmup
    if remaining < n_blocks * 10:
        n_blocks = max(1, remaining // 10)
    if n_blocks < 1 or remaining <= 0:
        return oof, np.zeros(n, dtype=bool)

    block = remaining // n_blocks

    for b in range(n_blocks):
        start = warmup + b * block
        end = n if b == n_blocks - 1 else start + block
        if end <= start:
            continue

        inner_train = train_df.iloc[:start]
        if len(inner_train) < 60:
            continue

        fitted = fit_panel(panel, inner_train, spec)
        rows = np.arange(start, end)
        # Experts see the frame up to `end` only -- never the outer test set.
        oof[rows] = panel_predict(fitted, train_df.iloc[:end], rows, spec)

        if verbose:
            print(f"    oof block {b}: fit on {len(inner_train)} rows, "
                  f"predicted rows {start}:{end}")

    valid = np.isfinite(oof).all(axis=1)
    return oof, valid


def oof_expert_errors(oof_preds: np.ndarray, y_true: np.ndarray) -> np.ndarray:
    """Absolute out-of-fold errors, for gate state vectors that include
    trailing expert performance.

    The proposal's market-state vector s_t specifies each expert's recent
    rolling error as an input to the gate. The original implementation
    accepted an `expert_error_cols` argument in
    `features.build_gate_state_vector` but never passed it, so the gate
    never saw them. These are the columns that were missing -- and they
    must be built from out-of-fold predictions for the same reason the
    oracle target must.
    """
    return np.abs(np.asarray(oof_preds) - np.asarray(y_true)[:, None])


def trailing_error_features(errors: np.ndarray, window: int = 10,
                            lag: int = 1) -> np.ndarray:
    """Lagged rolling mean of each expert's error.

    Lagged by one step so the feature at row t uses only errors realised
    strictly before t.
    """
    return (
        pd.DataFrame(errors)
        .shift(lag)
        .rolling(window, min_periods=max(1, window // 2))
        .mean()
        .bfill()
        .values
    )
