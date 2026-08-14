"""
Streamlit demo app for the project's "working demo" deliverable.

Shows: historical price chart, model forecast, and — the most interesting
visual for your presentation — how the gating network's expert weights
shift over time / across regimes. Run with:

    streamlit run app.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

sys.path.append(str(Path(__file__).resolve().parent.parent / "src"))
from experts import BoostingExpert, SequenceExpert
from gating import GatingNetwork

st.set_page_config(page_title="LME Base Metals Forecast (MoE Demo)", layout="wide")

st.title("LME Zinc & Aluminium Forecasting — Gated Mixture-of-Experts Demo")
st.caption(
    "Academic project demo. Currently running on synthetic sample data — "
    "swap in real LME data via src/fetch_data.py before drawing conclusions."
)

DATA_PATH = Path(__file__).resolve().parent.parent / "data"


@st.cache_data
def load_data(metal: str):
    fname = f"{metal}_features.csv"
    fpath = DATA_PATH / fname
    if not fpath.exists():
        st.warning(f"{fname} not found — generating from synthetic_lme_daily.csv on the fly.")
        sys.path.append(str(Path(__file__).resolve().parent.parent / "src"))
        from features import build_feature_set
        raw = pd.read_csv(DATA_PATH / "synthetic_lme_daily.csv", parse_dates=["date"])
        df = build_feature_set(raw, price_col=f"{metal}_close", inventory_col=f"{metal}_inventory")
        return df
    return pd.read_csv(fpath, parse_dates=["date"])


@st.cache_resource
def train_models(df: pd.DataFrame, price_col: str):
    n = len(df)
    split = int(n * 0.8)
    train, test = df.iloc[:split], df.iloc[split:]

    feature_cols = [c for c in df.columns if "lag" in c or "ma" in c or c.endswith("vol20")]
    gate_cols = [c for c in df.columns if c.startswith("gate_")]

    be = BoostingExpert().fit(train[feature_cols], train[price_col])
    se = SequenceExpert(window=20).fit(train[price_col])

    boost_train = be.predict(train[feature_cols])
    full_series = pd.concat([train[price_col], test[price_col]], ignore_index=True)
    seq_full = pd.Series(se.predict(full_series)).bfill().values
    seq_train = seq_full[:split]
    mom_train = train[price_col].shift(1).bfill().values

    expert_train_preds = np.column_stack([boost_train, seq_train, mom_train])
    gate = GatingNetwork().fit(train[gate_cols], expert_train_preds, train[price_col].values)

    return {
        "boosting": be, "sequence": se, "gate": gate,
        "feature_cols": feature_cols, "gate_cols": gate_cols,
        "split": split, "seq_full": seq_full,
    }


metal = st.sidebar.selectbox("Metal", ["zinc", "aluminium"])
df = load_data(metal)
price_col = f"{metal}_close"

models = train_models(df, price_col)
split = models["split"]
test = df.iloc[split:].reset_index(drop=True)

boost_test = models["boosting"].predict(test[models["feature_cols"]])
seq_test = models["seq_full"][split:]
seq_test = pd.Series(seq_test).bfill().values
mom_test = df[price_col].iloc[split - 1:-1].values[:len(test)]

expert_test_preds = np.column_stack([boost_test, seq_test, mom_test])
gated_pred, gate_weights = models["gate"].combine(test[models["gate_cols"]], expert_test_preds)

col1, col2 = st.columns([2, 1])

with col1:
    st.subheader(f"{metal.title()} price — actual vs. gated forecast")
    plot_df = pd.DataFrame({
        "date": test["date"],
        "actual": test[price_col].values,
        "gated_forecast": gated_pred,
    }).set_index("date")
    st.line_chart(plot_df)

with col2:
    st.subheader("Latest gate weights")
    latest_weights = gate_weights[-1]
    weight_df = pd.DataFrame({
        "expert": ["Boosting (XGBoost)", "Sequence (MLP)", "Momentum"],
        "weight": latest_weights,
    })
    st.bar_chart(weight_df.set_index("expert"))
    st.caption("How much the ensemble currently trusts each expert.")

st.subheader("Gate weights over time (regime adaptation)")
weights_df = pd.DataFrame(gate_weights, columns=["Boosting", "Sequence", "Momentum"])
weights_df["date"] = test["date"].values
st.area_chart(weights_df.set_index("date"))
st.caption(
    "If the architecture is working as intended, these weights should shift "
    "visibly around volatile periods / inventory shocks — this chart is "
    "your evidence for the paper that the gate has learned something "
    "meaningful, not just averaging blindly."
)

mae = np.mean(np.abs(gated_pred - test[price_col].values))
st.metric("Gated model MAE (test set)", f"{mae:.2f}")
