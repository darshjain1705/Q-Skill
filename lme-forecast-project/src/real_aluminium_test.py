"""
First real-data checkpoint: does the expert panel show any skill on 10 years
of REAL aluminium prices, with no synthetic anything?

    python real_aluminium_test.py

No inventory data exists yet, so this runs CONDITIONS["neither"] -- experts
and gate both blind to any fundamental signal. This is deliberately the
narrowest, most defensible claim available right now: "can this panel beat
a random walk on real prices at all?" The routing-vs-representation question
still needs real inventory data before it can be asked for real.
"""
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from expert_panel import default_panel, panel_names  # noqa: E402
from featureset import CONDITIONS, build_return_features  # noqa: E402
from experiment import summarize, walk_forward  # noqa: E402

DATA = "../data/real_aluminium_daily.csv"


def main():
    raw = pd.read_csv(DATA, parse_dates=["date"])
    print(f"Real aluminium data: {len(raw)} rows, "
          f"{raw['date'].min().date()} -> {raw['date'].max().date()}")

    df, spec = build_return_features(raw, "aluminium", **CONDITIONS["neither"])
    print(f"After feature construction: {len(df)} rows "
          f"({spec.describe()}, no inventory available yet)")

    panel = default_panel()
    names = panel_names(panel)
    folds = walk_forward(df, spec, panel, n_folds=8, min_train_frac=0.4)
    print(f"\nWalk-forward: {len(folds)} folds")

    model_names = (["rw"] + [f"expert_{n}" for n in names]
                  + ["simple_avg", "static_nnls"])
    summary = summarize(folds, model_names, panel)
    print("\nPooled out-of-sample results (real aluminium, 2016-2026):")
    print(summary.round(6).to_string())

    beat_rw = summary[summary["RelMAE_vs_RW"] < 1.0]
    sig_beat_rw = beat_rw[beat_rw["p_vs_RW"] < 0.05]
    print(f"\n{len(beat_rw)}/{len(summary)} methods numerically beat the random walk.")
    print(f"{len(sig_beat_rw)}/{len(summary)} beat it with statistical significance (p<0.05).")
    if len(sig_beat_rw):
        print("Significant winners:", list(sig_beat_rw.index))
    else:
        print("No method significantly beat the random walk on real aluminium data.")

    summary.to_csv("../results/08_real_aluminium_neither.csv")
    print("\nSaved -> results/08_real_aluminium_neither.csv")


if __name__ == "__main__":
    main()
