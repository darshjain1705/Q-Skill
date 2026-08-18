import warnings, sys
warnings.filterwarnings("ignore")
sys.path.insert(0, ".")
import pandas as pd
from expert_panel import default_panel, panel_names
from featureset import CONDITIONS, build_return_features
from experiment import summarize, walk_forward

raw = pd.read_csv("../data/real_zinc_daily.csv", parse_dates=["date"])
print(f"Real zinc data: {len(raw)} rows, {raw['date'].min().date()} -> {raw['date'].max().date()}")

df, spec = build_return_features(raw, "zinc", **CONDITIONS["neither"])
print(f"After feature construction: {len(df)} rows ({spec.describe()}, no inventory available yet)")

panel = default_panel()
names = panel_names(panel)
folds = walk_forward(df, spec, panel, n_folds=8, min_train_frac=0.4)
print(f"\nWalk-forward: {len(folds)} folds")

model_names = ["rw"] + [f"expert_{n}" for n in names] + ["simple_avg", "static_nnls"]
summary = summarize(folds, model_names, panel)
print("\nPooled out-of-sample results (real zinc, 2016-2026):")
print(summary.round(6).to_string())

beat_rw = summary[summary["RelMAE_vs_RW"] < 1.0]
sig_beat_rw = beat_rw[beat_rw["p_vs_RW"] < 0.05]
print(f"\n{len(beat_rw)}/{len(summary)} methods numerically beat the random walk.")
print(f"{len(sig_beat_rw)}/{len(summary)} beat it with statistical significance (p<0.05).")
if len(sig_beat_rw):
    print("Significant winners:", list(sig_beat_rw.index))
else:
    print("No method significantly beat the random walk on real zinc data.")

summary.to_csv("../results/08_real_zinc_neither.csv")
print("\nSaved -> results/08_real_zinc_neither.csv")
