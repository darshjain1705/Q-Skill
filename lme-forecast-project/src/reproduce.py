"""
Regenerate every number quoted in the project documentation.

    cd src && python reproduce.py

Writes machine-readable tables and a plain-text log to `../results/`.
Runtime is roughly 20 minutes on one core -- the walk-forward 2x2 refits
four experts once per out-of-fold block per fold per condition per metal,
which is the honest but expensive way to do it.

Each section maps to a claim in docs/routing-vs-representation.md, and the
section header says which.
"""
import io
import sys
import time
import warnings
from contextlib import redirect_stdout
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from expert_panel import (default_panel, fit_panel, panel_names,  # noqa: E402
                          panel_predict)
from featureset import CONDITIONS, build_return_features  # noqa: E402
from experiment import (routing_gain_decomposition, run_2x2,  # noqa: E402
                        routing_vs_representation_table)
from gating import GatingNetwork, StaticCombiner  # noqa: E402
from metrics import mae  # noqa: E402
from oof import blocked_oof_predictions  # noqa: E402
import synthetic_regime  # noqa: E402

RESULTS = Path(__file__).resolve().parent.parent / "results"
METALS = ("zinc", "aluminium")

_log_lines = []


def log(msg=""):
    print(msg)
    _log_lines.append(str(msg))


def save(df, name):
    path = RESULTS / name
    df.to_csv(path)
    log(f"    -> {path.relative_to(RESULTS.parent)}")


def section(title, claim):
    log("\n" + "=" * 78)
    log(title)
    log(f"  supports: {claim}")
    log("=" * 78)


# ---------------------------------------------------------------------

def step_0_generate_data():
    section("0. CONTROLLED TESTBED",
            "docs section 2 -- regimes differ by model class, signal leads")
    buf = io.StringIO()
    with redirect_stdout(buf):
        synthetic_regime.main(outdir=str(RESULTS.parent / "data"))
    log(buf.getvalue().rstrip())


def step_1_gate_selftest():
    section("1. GATE SELF-TEST",
            "docs section 3 -- double-softmax and early_stopping defects")
    rng = np.random.default_rng(0)
    T, n_experts, split = 1200, 3, 800

    regime = (rng.random(T) < 0.5).astype(int)
    for i in range(1, T):
        if rng.random() < 0.97:
            regime[i] = regime[i - 1]

    y = rng.normal(0, 1, T)
    preds = np.zeros((T, n_experts))
    preds[:, 0] = y + rng.normal(0, np.where(regime == 0, 0.2, 3.0))
    preds[:, 1] = y + rng.normal(0, np.where(regime == 0, 3.0, 0.2))
    preds[:, 2] = y + rng.normal(0, 2.0, T)
    state = pd.DataFrame({"regime_signal": regime + rng.normal(0, 0.25, T),
                          "noise": rng.normal(0, 1, T)})
    yt = y[split:]

    rows = {}
    for label, kw in [
        ("logit + softmax (fixed)", dict(parameterization="logit", early_stopping=False)),
        ("weight-space + clipping", dict(parameterization="weight", early_stopping=False)),
        ("logit, early_stopping=True", dict(parameterization="logit", early_stopping=True)),
        ("weight-space, early_stopping=True", dict(parameterization="weight", early_stopping=True)),
    ]:
        g = GatingNetwork(temperature=0.5, **kw).fit(state.iloc[:split], preds[:split], y[:split])
        pred, w = g.combine(state.iloc[split:], preds[split:])
        agree = np.mean(np.argmax(w, axis=1)
                        == np.argmin(np.abs(preds[split:] - yt[:, None]), axis=1))
        rows[label] = {"MAE": mae(yt, pred), "routing_agreement": agree,
                       "weight_std_over_time": float(np.mean(w.std(axis=0)))}

    static = StaticCombiner().fit(preds[:split], y[:split])
    rows["static combiner (control)"] = {
        "MAE": mae(yt, static.combine(preds[split:])[0]),
        "routing_agreement": np.nan, "weight_std_over_time": 0.0}
    rows["best single expert"] = {
        "MAE": min(mae(yt, preds[split:, i]) for i in range(n_experts)),
        "routing_agreement": np.nan, "weight_std_over_time": np.nan}

    t = pd.DataFrame(rows).T.sort_values("MAE")
    log(t.round(4).to_string())
    save(t, "01_gate_selftest.csv")


def step_2_expert_specialization(raw):
    section("2. EXPERT SPECIALIZATION BY REGIME",
            "docs section 2 -- boosting/ARIMA cross over between regimes")
    out = {}
    for metal in METALS:
        df, spec = build_return_features(raw, metal, inventory_in_experts=False,
                                         inventory_in_gate=True)
        n = len(df)
        split = int(n * 0.5)
        fitted = fit_panel(default_panel(), df.iloc[:split], spec)
        idx = np.arange(split, n)
        P = panel_predict(fitted, df, idx, spec)
        y = df[spec.target_col].values[idx]
        reg = df[spec.regime_col].values[idx]

        rw = {0: mae(y[reg == 0], np.zeros((reg == 0).sum())),
              1: mae(y[reg == 1], np.zeros((reg == 1).sum()))}
        for i, nm in enumerate(panel_names(default_panel())):
            lin = mae(y[reg == 0], P[reg == 0, i])
            thr = mae(y[reg == 1], P[reg == 1, i])
            out[(metal, nm)] = {
                "MAE_linear_regime": lin, "MAE_threshold_regime": thr,
                "relMAE_vs_RW_linear": lin / rw[0],
                "relMAE_vs_RW_threshold": thr / rw[1],
            }
    t = pd.DataFrame(out).T
    t.index.names = ["metal", "expert"]
    log(t.round(4).to_string())
    save(t, "02_expert_specialization.csv")


def step_3_regime_predictability(raw):
    section("3. IS THE REGIME PREDICTABLE FROM THE GATE'S INPUTS?",
            "docs section 4 -- inventory pressure predicts regime at AUC 0.85-0.90")
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score

    rows = {}
    for metal in METALS:
        for cond in ("neither", "routing"):
            df, spec = build_return_features(raw, metal, **CONDITIONS[cond])
            y = df[spec.regime_col].values
            X = df[spec.gate_cols].values
            s = int(len(df) * 0.5)
            for nm, clf in (("logistic", LogisticRegression(max_iter=2000)),
                            ("random_forest", RandomForestClassifier(
                                n_estimators=300, random_state=0))):
                clf.fit(X[:s], y[:s])
                auc = roc_auc_score(y[s:], clf.predict_proba(X[s:])[:, 1])
                rows[(metal, cond, nm)] = {"n_gate_features": len(spec.gate_cols),
                                           "AUC": auc}
    t = pd.DataFrame(rows).T
    t.index.names = ["metal", "condition", "classifier"]
    log(t.round(4).to_string())
    save(t, "03_regime_predictability.csv")


def step_4_decomposition(raw):
    section("4. ROUTING-GAIN DECOMPOSITION",
            "docs section 4 -- THE HEADLINE RESULT")
    tables, metas = {}, {}
    for metal in METALS:
        for cond in ("neither", "routing", "representation", "both"):
            df, spec = build_return_features(raw, metal, **CONDITIONS[cond])
            n = len(df)
            res = routing_gain_decomposition(df, spec, default_panel(),
                                             int(n * 0.7), n)
            if res is None:
                continue
            table, meta = res
            log(f"\n--- {metal} / {cond} ---")
            log(table.round(6).to_string())
            log(f"  regime classifier accuracy      : {meta['regime_classifier_accuracy']:.4f}")
            log(f"  oracle gain over static         : {meta['oracle_gain_%']:.3f}%")
            log(f"  fraction retained by best learned: {meta['fraction_of_gain_retained_by_best_learned']:.4f}")
            for rung in table.index:
                tables[(metal, cond, rung)] = table.loc[rung].to_dict()
            metas[(metal, cond)] = meta

    t = pd.DataFrame(tables).T
    t.index.names = ["metal", "condition", "rung"]
    save(t, "04_routing_gain_decomposition.csv")
    m = pd.DataFrame(metas).T
    m.index.names = ["metal", "condition"]
    save(m, "04_decomposition_summary.csv")


def step_5_full_2x2(raw):
    section("5. FULL 2x2 WALK-FORWARD",
            "docs section 1 -- routing vs representation, all models")
    for metal in METALS:
        log(f"\n######## {metal} ########")
        buf = io.StringIO()
        with redirect_stdout(buf):
            results, diags, _ = run_2x2(raw, metal, n_folds=5,
                                        min_train_frac=0.5, verbose=True)
        log(buf.getvalue().rstrip())

        for cond, tbl in results.items():
            save(tbl, f"05_{metal}_{cond}_models.csv")

        head = routing_vs_representation_table(results)
        log("\n  ROUTING vs REPRESENTATION")
        log(head.round(6).to_string())
        save(head, f"05_{metal}_routing_vs_representation.csv")

        d = pd.DataFrame({c: {k: str(v) for k, v in dg.items()}
                          for c, dg in diags.items()}).T
        save(d, f"05_{metal}_gate_diagnostics.csv")


def main():
    RESULTS.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    log(f"Reproduction run started {time.strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"numpy {np.__version__} | pandas {pd.__version__} | python {sys.version.split()[0]}")

    step_0_generate_data()
    raw = pd.read_csv(RESULTS.parent / "data" / "synthetic_regime_daily.csv",
                      parse_dates=["date"])

    step_1_gate_selftest()
    step_2_expert_specialization(raw)
    step_3_regime_predictability(raw)
    step_4_decomposition(raw)
    step_5_full_2x2(raw)

    log(f"\nCompleted in {(time.time() - t0) / 60:.1f} minutes.")
    (RESULTS / "00_run_log.txt").write_text("\n".join(_log_lines) + "\n")
    print(f"\nLog written to {RESULTS / '00_run_log.txt'}")


if __name__ == "__main__":
    main()
