"""
Scoreboard for whatever you write in `my_algorithm.py`.

    python evaluate_my_algorithm.py
    python evaluate_my_algorithm.py --metal zinc --condition routing

Runs your `MyRouter` through the same walk-forward backtest as every
other method, against every control, with significance tests, and prints
a verdict.

WHY THE VERDICT IS HARSH ON PURPOSE. It is easy to build a router that
beats the weakest baseline and call it a success. The test that matters
is the STATIC COMBINER -- one fixed weight vector, no routing. If you
cannot beat that, your algorithm's whole premise (that weights should
vary with market state) has not been demonstrated, however good the
numbers look next to a single expert.

The oracle row is not a competitor. It tells you what fraction of the
achievable gain you captured, which is the number to report.
"""
import argparse
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from expert_panel import default_panel, fit_panel, panel_names, panel_predict
from experiment import _build_gate_state
from featureset import CONDITIONS, build_return_features
from gating import ClusteredRouter, GatingNetwork, OracleRouter, StaticCombiner
from metrics import diebold_mariano, directional_accuracy, mae, rel_mae
from my_algorithm import MyRouter, routing_economics
from oof import blocked_oof_predictions, trailing_error_features


def run(raw, metal, condition, n_folds, min_train_frac, my_params):
    df, spec = build_return_features(raw, metal, **CONDITIONS[condition])
    panel = default_panel()
    n = len(df)
    warm = int(n * min_train_frac)
    fold = (n - warm) // n_folds

    acc = {}
    econ_rows = []

    for k in range(n_folds):
        s = warm + k * fold
        e = n if k == n_folds - 1 else s + fold

        train_df = df.iloc[:s].reset_index(drop=True)
        test_idx = np.arange(s, e)
        y_tr = train_df[spec.target_col].values
        y_te = df[spec.target_col].values[test_idx]

        oof, valid = blocked_oof_predictions(panel, train_df, spec)
        if valid.sum() < 60:
            continue
        fitted = fit_panel(panel, train_df, spec)
        te_preds = panel_predict(fitted, df.iloc[:e], test_idx, spec)

        all_err = np.full((e, len(panel)), np.nan)
        all_err[:s] = np.abs(oof - y_tr[:, None])
        all_err[s:e] = np.abs(te_preds - y_te[:, None])
        trail = trailing_error_features(all_err, window=10, lag=1)

        X_tr = _build_gate_state(df, spec, np.where(valid)[0], trail)
        X_te = _build_gate_state(df, spec, test_idx, trail)
        oof_v, y_v = oof[valid], y_tr[valid]

        preds = {"rw": np.zeros_like(y_te),
                 "simple_avg": te_preds.mean(axis=1)}
        for i, nm in enumerate(panel_names(panel)):
            preds[f"expert_{nm}"] = te_preds[:, i]

        preds["static"] = StaticCombiner().fit(oof_v, y_v).combine(te_preds)[0]
        preds["gated_trailing"] = GatingNetwork(
            temperature=0.5, oracle_mode="trailing").fit(
            X_tr, oof_v, y_v).combine(X_te, te_preds)[0]
        preds["clustered_k3"] = ClusteredRouter(n_regimes=3).fit(
            X_tr, oof_v, y_v).combine(X_te, te_preds)[0]

        # ---- your algorithm ----
        preds["MY_ALGORITHM"] = MyRouter(**my_params).fit(
            X_tr, oof_v, y_v).combine(X_te, te_preds)[0]

        if spec.regime_col is not None:
            r_tr = df[spec.regime_col].values[:s][valid]
            r_te = df[spec.regime_col].values[test_idx]
            preds["ORACLE (upper bound)"] = OracleRouter().fit(
                r_tr, oof_v, y_v).combine(r_te, te_preds)[0]
            try:
                econ_rows.append(routing_economics(te_preds, y_te, r_te))
            except Exception:
                pass

        acc.setdefault("y", []).append(y_te)
        for kk, v in preds.items():
            acc.setdefault(kk, []).append(v)

    y = np.concatenate(acc.pop("y"))
    pooled = {kk: np.concatenate(v) for kk, v in acc.items()}
    return y, pooled, econ_rows, spec


def report(y, pooled, econ_rows, metal, condition):
    static = pooled["static"]
    rw = pooled["rw"]

    rows = {}
    for name, p in pooled.items():
        d = directional_accuracy(y, p)
        rows[name] = {
            "MAE_x1e3": mae(y, p) * 1e3,
            "vs_static_%": (mae(y, p) / mae(y, static) - 1) * 100,
            "RelMAE_vs_RW": rel_mae(y, p, rw),
            "DirAcc": d.accuracy,
            "p_vs_static": diebold_mariano(y, p, static).p_value,
        }
    table = pd.DataFrame(rows).T.sort_values("MAE_x1e3")

    print("\n" + "=" * 78)
    print(f"RESULTS -- {metal} / condition = {condition}")
    print("=" * 78)
    print(table.round(4).to_string())

    if econ_rows:
        econ = pd.DataFrame(econ_rows).mean()
        print(f"\nRouting economics (averaged over folds):")
        print(f"  available gain from perfect routing : {econ['available_gain_pct']:.2f}%")
        print(f"  break-even classifier accuracy      : {econ['p_star_breakeven_accuracy']:.1%}")

    # ---- verdict ----
    mine, s_mae = mae(y, pooled["MY_ALGORITHM"]), mae(y, static)
    p = diebold_mariano(y, pooled["MY_ALGORITHM"], static).p_value
    delta = (mine / s_mae - 1) * 100

    print("\n" + "-" * 78)
    print("VERDICT")
    print("-" * 78)
    if np.isclose(mine, s_mae, rtol=1e-9):
        print("  Your router is still the placeholder (identical to static).")
        print("  Edit my_algorithm.py -- see the three directions in its docstring.")
    elif delta < 0 and p < 0.05:
        print(f"  BEATS static by {-delta:.2f}% and the difference is significant (p={p:.4f}).")
        print("  This is a real result. Next: check it holds on the other metal and")
        print("  in every condition, then ablate your own components one at a time.")
    elif delta < 0:
        print(f"  Beats static by {-delta:.2f}%, but not significantly (p={p:.4f}).")
        print("  Promising, not yet a claim. More folds or a stronger mechanism.")
    else:
        print(f"  LOSES to static by {delta:.2f}% (p={p:.4f}).")
        print("  Routing is costing more than it earns. Check: is your effective")
        print("  regime accuracy above the break-even printed above? If not, shrink")
        print("  harder toward the static weights when confidence is low.")

    if "ORACLE (upper bound)" in pooled:
        o = mae(y, pooled["ORACLE (upper bound)"])
        gain = s_mae - o
        if gain > 0:
            print(f"\n  Captured {(s_mae - mine) / gain * 100:.1f}% of the gain the oracle shows is available.")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../data/synthetic_regime_daily.csv")
    ap.add_argument("--metal", default="aluminium", choices=["zinc", "aluminium", "both"])
    ap.add_argument("--condition", default="both", choices=list(CONDITIONS) + ["all"])
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--min-train-frac", type=float, default=0.5)
    a = ap.parse_args()

    raw = pd.read_csv(a.data, parse_dates=["date"])
    metals = ["zinc", "aluminium"] if a.metal == "both" else [a.metal]
    conds = list(CONDITIONS) if a.condition == "all" else [a.condition]

    for m in metals:
        for c in conds:
            y, pooled, econ, _ = run(raw, m, c, a.folds, a.min_train_frac, {})
            report(y, pooled, econ, m, c)


if __name__ == "__main__":
    main()
