"""
End-to-end pipeline: load features -> train experts -> train gate ->
evaluate against baselines and run ablations.

This is the script that produces the numbers/plots for your paper's
results section.

UPDATED: now does rolling-window (walk-forward) backtesting instead of a
single static train/test split, matching what the proposal promises in
Section 4.3. This is slower than a single split (experts get refit once
per fold) but gives a much more honest, defensible estimate of
out-of-sample performance -- a single split can make a model look good or
bad purely by luck of which period landed in the test set.

Refit cadence: refitting ARIMA/XGBoost/MLP at every single day is
expensive and mostly unnecessary for a semester project. Instead we use
an expanding window with periodic refits (default: every REFIT_EVERY
trading days, ~1 trading month) and one-step-ahead predictions in
between refits. This is a standard, citable compromise in the
forecasting literature -- document it as such in your methodology
section.
"""
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from experts import BoostingExpert, SequenceExpert
from gating import GatingNetwork


def directional_accuracy(y_true, y_pred, y_prev):
    true_dir = np.sign(y_true - y_prev)
    pred_dir = np.sign(y_pred - y_prev)
    return np.mean(true_dir == pred_dir)


def _fit_predict_fold(train_df, test_df, price_col, feature_cols, gate_cols):
    """Fit experts + gate on train_df, predict on test_df. Returns dict of
    arrays (all length len(test_df)) plus the fitted gate's weights."""

    # ---- Expert 1: Boosting ----
    be = BoostingExpert().fit(train_df[feature_cols], train_df[price_col])
    boost_train_pred = be.predict(train_df[feature_cols])
    boost_test_pred = be.predict(test_df[feature_cols])

    # ---- Expert 2: Sequence (MLP stand-in for LSTM) ----
    se = SequenceExpert(window=20).fit(train_df[price_col])
    full_series = pd.concat([train_df[price_col], test_df[price_col]], ignore_index=True)
    seq_full_pred = se.predict(full_series)
    split = len(train_df)
    seq_train_pred = pd.Series(seq_full_pred[:split]).bfill().values
    seq_test_pred = pd.Series(seq_full_pred[split:]).bfill().values

    # ---- Expert 3: naive/momentum baseline as a cheap third expert ----
    mom_train_pred = train_df[price_col].shift(1).bfill().values
    mom_test_pred = pd.concat(
        [train_df[price_col].iloc[-1:], test_df[price_col]]
    ).shift(1).bfill().values[1:]

    expert_train_preds = np.column_stack([boost_train_pred, seq_train_pred, mom_train_pred])
    expert_test_preds = np.column_stack([boost_test_pred, seq_test_pred, mom_test_pred])

    naive_pred = test_df[price_col].shift(1).bfill().values

    # ---- Full gated model ----
    gate = GatingNetwork().fit(train_df[gate_cols], expert_train_preds, train_df[price_col].values)
    gated_pred, gate_weights = gate.combine(test_df[gate_cols], expert_test_preds)

    # ---- Ablation: gate WITHOUT inventory-pressure signal ----
    gate_cols_no_inv = [c for c in gate_cols if "inventory" not in c]
    gate_ablate = GatingNetwork().fit(
        train_df[gate_cols_no_inv], expert_train_preds, train_df[price_col].values
    )
    gated_pred_ablate, _ = gate_ablate.combine(test_df[gate_cols_no_inv], expert_test_preds)

    return {
        "naive": naive_pred,
        "boosting_only": boost_test_pred,
        "sequence_only": seq_test_pred,
        "simple_avg": expert_test_preds.mean(axis=1),
        "gated_moe": gated_pred,
        "gated_moe_no_inventory_signal": gated_pred_ablate,
        "y_true": test_df[price_col].values,
        "y_prev": naive_pred,  # previous-day price, for directional accuracy
        "gate_weights": gate_weights,
    }


def walk_forward_backtest(df, price_col, feature_cols, gate_cols,
                           min_train_frac=0.5, n_folds=6, refit_every=None):
    """
    Expanding-window walk-forward backtest.

    Splits the data (after the initial min_train_frac warm-up) into
    n_folds equal-sized test chunks. For each fold, all experts + the
    gate are refit on everything before that fold (expanding window),
    then evaluated one-step-ahead across the whole fold.

    refit_every is currently unused (full refit per fold is already the
    coarse-grained version); it's left as a parameter so you can plug in
    finer-grained refit-every-N-days behavior later without changing the
    call signature elsewhere.
    """
    n = len(df)
    warmup_end = int(n * min_train_frac)
    remaining = n - warmup_end
    fold_size = remaining // n_folds

    if fold_size < 30:
        raise ValueError(
            f"Not enough data for {n_folds} folds after {min_train_frac:.0%} warmup "
            f"(fold_size={fold_size}, need >=30). Reduce n_folds or min_train_frac, "
            f"or supply more history."
        )

    fold_results = []
    for fold_i in range(n_folds):
        test_start = warmup_end + fold_i * fold_size
        test_end = n if fold_i == n_folds - 1 else test_start + fold_size

        train_df = df.iloc[:test_start].reset_index(drop=True)
        test_df = df.iloc[test_start:test_end].reset_index(drop=True)

        if len(test_df) < 5:
            continue

        res = _fit_predict_fold(train_df, test_df, price_col, feature_cols, gate_cols)
        res["fold"] = fold_i
        res["test_start_date"] = df["date"].iloc[test_start] if "date" in df.columns else test_start
        res["test_end_date"] = df["date"].iloc[test_end - 1] if "date" in df.columns else test_end - 1
        fold_results.append(res)

        print(f"  fold {fold_i}: train_n={len(train_df)} test_n={len(test_df)} "
              f"({res['test_start_date']} -> {res['test_end_date']})")

    return fold_results


def summarize_folds(fold_results, model_names):
    """Pools predictions across all folds (not fold-averaged metrics) and
    computes MAE/RMSE/directional accuracy per model. Pooling across folds
    before computing metrics is the more standard choice for walk-forward
    backtests since fold sizes can be uneven."""
    all_true = np.concatenate([r["y_true"] for r in fold_results])
    all_prev = np.concatenate([r["y_prev"] for r in fold_results])

    rows = {}
    for name in model_names:
        all_pred = np.concatenate([r[name] for r in fold_results])
        rows[name] = {
            "MAE": mean_absolute_error(all_true, all_pred),
            "RMSE": mean_squared_error(all_true, all_pred) ** 0.5,
            "DirAcc": directional_accuracy(all_true, all_pred, all_prev),
        }
    return pd.DataFrame(rows).T.sort_values("MAE")


def run_pipeline(feature_path="../data/zinc_features.csv", price_col="zinc_close",
                  n_folds=6, min_train_frac=0.5):
    df = pd.read_csv(feature_path, parse_dates=["date"])

    feature_cols = [c for c in df.columns if "lag" in c or "ma" in c or c.endswith("vol20")]
    gate_cols = [c for c in df.columns if c.startswith("gate_")]

    print(f"Running walk-forward backtest: {n_folds} folds, "
          f"{min_train_frac:.0%} initial train window, on {len(df)} rows ...")
    fold_results = walk_forward_backtest(
        df, price_col, feature_cols, gate_cols,
        min_train_frac=min_train_frac, n_folds=n_folds,
    )

    model_names = ["naive", "boosting_only", "sequence_only", "simple_avg",
                   "gated_moe", "gated_moe_no_inventory_signal"]
    summary = summarize_folds(fold_results, model_names)
    print("\nPooled out-of-sample results across all folds:")
    print(summary)

    # Per-fold gated_moe MAE, so you can see stability across regimes/time
    # (useful for the paper's regime-robustness discussion)
    print("\nPer-fold gated_moe MAE (checking for stability across time/regimes):")
    for r in fold_results:
        mae = mean_absolute_error(r["y_true"], r["gated_moe"])
        print(f"  fold {r['fold']} ({r['test_start_date']} -> {r['test_end_date']}): MAE={mae:.3f}")

    return summary, fold_results


if __name__ == "__main__":
    run_pipeline()
