"""
Feature construction for the return-target setting, with the routing /
representation split made explicit.

This is the module that makes the project's central question askable.
`features.py` builds one undifferentiated feature frame; here the columns
are partitioned into two sets that are varied INDEPENDENTLY:

    expert features -- what the forecasting models see (representation)
    gate features   -- what the router sees when choosing among them (routing)

The inventory-pressure signal can be placed in either, both, or neither,
which is exactly the 2x2 the paper turns on:

               gate WITHOUT inv     gate WITH inv
    experts
    WITHOUT inv     (a) neither         (c) routing only
    WITH inv        (b) representation  (d) both

The original design could only ever run (b) and (d) -- it had no way to
express "the signal informs which model to trust, but not what any model
predicts", which is the actually novel hypothesis.

TARGET. Everything predicts the NEXT-DAY LOG RETURN, not the price level.
On levels, lagged-price features make every model an approximation of
persistence and the random walk wins by construction. All alignment here
is one-directional: row t carries information observable at t and a target
realised at t+1.
"""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from features import hurst_exponent


@dataclass
class FeatureSpec:
    """Column bookkeeping for one metal under one 2x2 condition."""
    metal: str
    target_col: str
    price_col: str
    return_col: str
    expert_cols: list = field(default_factory=list)
    gate_cols: list = field(default_factory=list)
    regime_col: str = None

    def describe(self) -> str:
        return (f"{self.metal}: {len(self.expert_cols)} expert features, "
                f"{len(self.gate_cols)} gate features")


def inventory_pressure_index(inventory: pd.Series, window: int = 20,
                             weights=(0.5, 0.3, 0.2)) -> pd.Series:
    """Rolling z-scored composite of stock level, its rate of change, and
    the volatility of that change.

    Unchanged in spirit from `features.py`, but the component weights are
    now a parameter rather than three literals buried in the body. The
    original hard-coded 0.5/0.3/0.2 with a comment conceding they were
    unjustified; a reviewer will ask, and `experiment.py` can now sweep
    them as a robustness check instead of the answer being "we picked
    them".
    """
    w_level, w_delta, w_vol = weights
    level, delta = inventory, inventory.diff()

    def z(s):
        m = s.rolling(window).mean()
        sd = s.rolling(window).std()
        return (s - m) / sd.replace(0, np.nan)

    # Low stock = high pressure, hence the sign flip on the level term.
    return (-w_level * z(level).fillna(0)
            + w_delta * z(-delta).fillna(0)
            + w_vol * z(delta.rolling(window).std()).fillna(0))


def build_return_features(
    df: pd.DataFrame,
    metal: str,
    inventory_in_experts: bool = False,
    inventory_in_gate: bool = False,
    ret_lags=(1, 2, 3, 4, 5, 10),
    hurst_window: int = 60,
) -> tuple:
    """Build the feature frame and the column partition for one condition.

    Returns (frame, FeatureSpec). The frame always CONTAINS every column;
    the spec decides which ones each component is allowed to look at, so
    the four 2x2 conditions share one frame and differ only in the spec.
    That keeps the conditions exactly comparable -- same rows, same
    dropna, same folds.
    """
    price_col = f"{metal}_close"
    inv_col = f"{metal}_inventory"
    out = df.copy()

    ret = np.log(out[price_col]).diff()
    out[f"{metal}_ret"] = ret

    # ---- target: next-day return (the only forward-looking column) ----
    target_col = f"{metal}_ret_next"
    out[target_col] = ret.shift(-1)

    expert_cols, gate_cols = [], []

    # ---- expert features: everything observable at t --------------------
    for lag in ret_lags:
        c = f"{metal}_ret_lag{lag}"
        out[c] = ret.shift(lag - 1)     # lag1 == today's return
        expert_cols.append(c)

        c = f"{metal}_absret_lag{lag}"  # magnitudes: the threshold regime
        out[c] = ret.abs().shift(lag - 1)  # is only visible through these
        expert_cols.append(c)

    for w in (5, 10, 20):
        c = f"{metal}_vol{w}"
        out[c] = ret.rolling(w).std()
        expert_cols.append(c)

    c = f"{metal}_ma_ratio"
    out[c] = out[price_col].rolling(5).mean() / out[price_col].rolling(20).mean() - 1.0
    expert_cols.append(c)

    # ---- gate state vector ---------------------------------------------
    out[f"gate_{metal}_vol"] = ret.rolling(20).std()
    gate_cols.append(f"gate_{metal}_vol")

    out[f"gate_{metal}_vol_change"] = (
        ret.rolling(10).std() / ret.rolling(40).std().replace(0, np.nan) - 1.0
    )
    gate_cols.append(f"gate_{metal}_vol_change")

    out[f"gate_{metal}_hurst"] = (
        out[price_col].rolling(hurst_window)
        .apply(lambda x: hurst_exponent(x.values), raw=False)
    )
    gate_cols.append(f"gate_{metal}_hurst")

    out[f"gate_{metal}_absret_ac"] = (
        ret.abs().rolling(40).apply(lambda x: pd.Series(x).autocorr(1), raw=False)
    )
    gate_cols.append(f"gate_{metal}_absret_ac")

    # ---- the fundamental signal, routed to whichever side(s) apply ------
    ipi_col = f"{metal}_inv_pressure"
    if inv_col in out.columns:
        out[ipi_col] = inventory_pressure_index(out[inv_col])
        out[f"{metal}_inv_delta"] = out[inv_col].pct_change()
    else:
        out[ipi_col] = np.nan
        out[f"{metal}_inv_delta"] = np.nan

    if inventory_in_experts:
        expert_cols += [ipi_col, f"{metal}_inv_delta"]
    if inventory_in_gate:
        gate_cols.append(ipi_col)

    regime_col = f"{metal}_regime_next" if f"{metal}_regime_next" in out.columns else None

    keep = ["date", price_col, target_col, f"{metal}_ret"] + expert_cols + gate_cols
    if regime_col:
        keep.append(regime_col)
    keep = list(dict.fromkeys(keep))

    out = out[keep].replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)

    spec = FeatureSpec(
        metal=metal,
        target_col=target_col,
        price_col=price_col,
        return_col=f"{metal}_ret",
        expert_cols=expert_cols,
        gate_cols=gate_cols,
        regime_col=regime_col,
    )
    return out, spec


CONDITIONS = {
    "neither":        dict(inventory_in_experts=False, inventory_in_gate=False),
    "representation": dict(inventory_in_experts=True,  inventory_in_gate=False),
    "routing":        dict(inventory_in_experts=False, inventory_in_gate=True),
    "both":           dict(inventory_in_experts=True,  inventory_in_gate=True),
}


if __name__ == "__main__":
    raw = pd.read_csv("../data/synthetic_regime_daily.csv", parse_dates=["date"])
    for name, cfg in CONDITIONS.items():
        frame, spec = build_return_features(raw, "zinc", **cfg)
        print(f"{name:16s} rows={len(frame):5d}  {spec.describe()}")
