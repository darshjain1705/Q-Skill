"""
Turns the evaluation harness's technical output into plain English.

    python human_readable_report.py                    # reads results/06_*.csv
    python human_readable_report.py --metal aluminium   # one metal only

WHY THIS EXISTS. `evaluate_my_algorithm.py` and `experiment.py` print tables
like:

    static           10.9502   0.0000   0.8940   0.5992      NaN
    MY_ALGORITHM     10.9526   0.0234   0.8943   0.5992   0.7563

which is the right format for verifying the pipeline, and the wrong format
for showing anyone else. This module is the translation layer: same
underlying numbers, method names and columns turned into sentences a
first-time reader doesn't need a glossary for.

It never recomputes anything -- it reads the CSVs the evaluation scripts
already wrote to `results/`, so it's instant and always matches whatever
was last actually run.
"""
import argparse
from pathlib import Path

import pandas as pd

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"

METHOD_NAMES = {
    "ORACLE (upper bound)": "Perfect hindsight (not a real method -- shows the ceiling)",
    "oracle_router": "Perfect hindsight (not a real method -- shows the ceiling)",
    "static": "Safe blend (no switching)",
    "static_nnls": "Safe blend (no switching)",
    "MY_ALGORITHM": "Your algorithm (confidence-aware switcher)",
    "gated": "Your algorithm (confidence-aware switcher)",
    "gated_trailing": "Old switcher (always acts, ignores confidence)",
    "clustered_k3": "Aggressive switcher (always acts, no caution)",
    "simple_avg": "Simple average of all methods",
    "rw": "Doing nothing (tomorrow = today)",
    "expert_boosting": "Tree-based model, on its own",
    "expert_arima": "Classical statistics model, on its own",
    "expert_ridge_ar": "Simple linear model, on its own",
    "expert_sequence": "Neural network model, on its own",
    "expert_ridge": "Simple linear model, on its own",
}

CONDITION_NAMES = {
    "neither": "signal used nowhere",
    "representation": "signal fed to the prediction models",
    "routing": "signal fed to the switcher",
    "both": "signal fed to both",
}


def friendly_name(raw: str) -> str:
    return METHOD_NAMES.get(raw, raw)


def significance_label(p) -> str:
    if pd.isna(p):
        return "-- (this is the baseline everything else is measured against)"
    p = float(p)
    if p < 0.05:
        return "YES -- a real, confirmed difference"
    if p < 0.10:
        return "borderline -- probably noise, worth another look"
    return "no -- statistically just noise"


def render_metal_condition(metal: str, condition: str, rows: pd.DataFrame) -> str:
    out = []
    cond_label = CONDITION_NAMES.get(condition, condition)
    out.append("=" * 74)
    out.append(f"{metal.upper()} -- {cond_label}")
    out.append("=" * 74)
    out.append("Lower 'average error' is better. 'vs. safe blend' shows how much worse")
    out.append("(+) or better (-) each method was than just not switching at all.")
    out.append("")

    models = rows[~rows["model"].str.startswith("ECONOMICS")].copy()
    models["MAE_x1e3"] = pd.to_numeric(models["MAE_x1e3"], errors="coerce")
    models = models.sort_values("MAE_x1e3")

    name_w = max(len(friendly_name(m)) for m in models["model"]) + 2
    header = (f"  {'Method':<{name_w}} {'Avg. error':>11} {'vs. safe blend':>15}   "
             f"{'Real difference?'}")
    out.append(header)
    out.append("  " + "-" * (len(header) - 2))

    for _, r in models.iterrows():
        name = friendly_name(r["model"])
        mae = f"{float(r['MAE_x1e3']):.3f}" if pd.notna(r["MAE_x1e3"]) else "--"
        vs = r.get("vs_static_pct", "")
        try:
            vs_f = float(vs)
            vs_str = "--" if vs_f == 0 else f"{vs_f:+.2f}%"
        except (ValueError, TypeError):
            vs_str = "--"
        sig = significance_label(r.get("p_vs_static", None))
        out.append(f"  {name:<{name_w}} {mae:>11} {vs_str:>15}   {sig}")

    econ = rows[rows["model"].str.startswith("ECONOMICS")]
    if not econ.empty:
        gain = econ[econ["model"].str.contains("gain")]["MAE_x1e3"]
        thresh = econ[econ["model"].str.contains("breakeven")]["MAE_x1e3"]
        out.append("")
        if len(gain):
            out.append(f"  If a switcher could read the market perfectly, the most it could "
                       f"gain here is {float(gain.iloc[0]):.1f}%.")
        if len(thresh):
            out.append(f"  A switcher needs to correctly identify the market condition about "
                       f"{float(thresh.iloc[0]):.0f}% of the time before switching is worth it "
                       f"at all.")

    my = models[models["model"] == "MY_ALGORITHM"]
    static = models[models["model"] == "static"]
    if len(my) and len(static):
        my_mae = float(my["MAE_x1e3"].iloc[0])
        st_mae = float(static["MAE_x1e3"].iloc[0])
        p = my.get("p_vs_static", pd.Series([None])).iloc[0]
        out.append("")
        if pd.notna(p) and float(p) < 0.05:
            verdict = "a real win" if my_mae < st_mae else "a real loss"
        else:
            verdict = "statistically tied with just not switching at all"
        out.append(f"  BOTTOM LINE: your algorithm is {verdict}.")

    out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--metal", default=None, choices=["zinc", "aluminium"])
    ap.add_argument("--csv", default=str(RESULTS_DIR / "06_my_algorithm_summary.csv"))
    ap.add_argument("--out", default=None, help="also write the report to this text file")
    a = ap.parse_args()

    df = pd.read_csv(a.csv)
    metals = [a.metal] if a.metal else sorted(df["metal"].unique())

    report_parts = []
    for metal in metals:
        for condition in [c for c in df["condition"].unique()
                          if not df[(df.metal == metal) & (df.condition == c)].empty]:
            sub = df[(df.metal == metal) & (df.condition == condition)]
            if sub.empty:
                continue
            report_parts.append(render_metal_condition(metal, condition, sub))

    text = "\n".join(report_parts)
    print(text)

    if a.out:
        Path(a.out).write_text(text)
        print(f"\n[also written to {a.out}]")


if __name__ == "__main__":
    main()
