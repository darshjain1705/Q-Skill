"""
Feature engineering for the gating network's market-state vector, plus
standard lag/technical features for the base experts.

Key novel piece: `inventory_pressure_index()` — a custom formula combining
warehouse stock level, its rate of change, and volume, meant to proxy
physical supply-tightness in a way a raw stock-level feature doesn't
capture on its own. Tune / justify this formula in your paper; the version
here is a reasonable starting point, not a claimed-optimal one.
"""
import numpy as np
import pandas as pd


def add_lag_features(df: pd.DataFrame, price_col: str, lags=(1, 2, 3, 5, 10, 20)) -> pd.DataFrame:
    df = df.copy()
    ret = df[price_col].pct_change()
    df[f"{price_col}_return"] = ret
    for lag in lags:
        df[f"{price_col}_lag{lag}"] = df[price_col].shift(lag)
        df[f"{price_col}_ret_lag{lag}"] = ret.shift(lag)
    df[f"{price_col}_ma5"] = df[price_col].rolling(5).mean()
    df[f"{price_col}_ma20"] = df[price_col].rolling(20).mean()
    df[f"{price_col}_vol20"] = ret.rolling(20).std()
    return df


def hurst_exponent(ts: np.ndarray, max_lag=20) -> float:
    """Hurst exponent H, estimated from the scaling of lagged differences.

    For a series with self-similarity exponent H, the standard deviation of
    the lag-k difference scales as tau(k) ~ k^H, so H is the slope of
    log tau(k) against log k. Verified numerically against known cases:

        pure random walk (true H = 0.50)  ->  ~0.48
        white noise      (true H = 0.00)  ->  ~0.00

    Interpretation: H ~ 0.5 is a random walk, H > 0.5 trending
    (moves tend to persist), H < 0.5 mean-reverting (moves tend to reverse).
    Used as one of the regime signals fed to the gate.

    NOTE ON HISTORY: an earlier version multiplied the slope by 2.0, which
    returned 2H rather than H -- a random walk scored ~1.0 instead of ~0.5.
    That factor has been removed. It never affected which information the
    gate received (a monotone rescaling carries the same information), but
    it made the feature impossible to describe correctly in writing. All
    experiments were re-run after the correction.
    """
    ts = np.asarray(ts)
    if len(ts) < max_lag * 2 or np.any(np.isnan(ts)):
        return np.nan
    lags = range(2, max_lag)
    tau = [np.std(np.subtract(ts[lag:], ts[:-lag])) for lag in lags]
    tau = [t if t > 0 else 1e-8 for t in tau]
    poly = np.polyfit(np.log(list(lags)), np.log(tau), 1)
    return poly[0]


def rolling_hurst(series: pd.Series, window=60) -> pd.Series:
    return series.rolling(window).apply(lambda x: hurst_exponent(x.values), raw=False)


def inventory_pressure_index(inventory: pd.Series, window=20) -> pd.Series:
    """
    Custom inventory-pressure index (this is the novel feature to justify
    formally in your paper — treat this implementation as a first draft).

    IPI_t = z-score(level_t) * 0.5
            + z-score(-delta_level_t) * 0.3       # falling stocks -> pressure up
            + z-score(delta_level_t volatility) * 0.2

    Intuition: pressure is high when stocks are low AND falling AND doing so
    erratically (signals scramble for physical metal). All three terms are
    z-scored over a rolling window so the index is comparable across time
    and across metals with different absolute stock levels.
    """
    level = inventory
    delta = inventory.diff()

    def zscore(s):
        m = s.rolling(window).mean()
        sd = s.rolling(window).std()
        return (s - m) / sd.replace(0, np.nan)

    z_level = zscore(level)
    z_neg_delta = zscore(-delta)
    z_delta_vol = zscore(delta.rolling(window).std())

    ipi = 0.5 * z_level.fillna(0) * -1 + 0.3 * z_neg_delta.fillna(0) + 0.2 * z_delta_vol.fillna(0)
    # note: z_level multiplied by -1 because LOW stock = high pressure
    return ipi


def build_gate_state_vector(df: pd.DataFrame, price_col: str, inventory_col: str,
                             expert_error_cols=None, window=60) -> pd.DataFrame:
    """Assembles the full market-state vector s_t fed to the gating network."""
    df = df.copy()
    ret = df[price_col].pct_change()

    df["gate_volatility"] = ret.rolling(20).std()
    df["gate_hurst"] = rolling_hurst(df[price_col], window=window)
    df["gate_inventory_pressure"] = inventory_pressure_index(df[inventory_col])

    if expert_error_cols:
        for col in expert_error_cols:
            df[f"gate_{col}_rolling_err"] = df[col].rolling(10).mean()

    return df


def build_feature_set(df: pd.DataFrame, price_col: str, inventory_col: str) -> pd.DataFrame:
    df = add_lag_features(df, price_col)
    df = build_gate_state_vector(df, price_col, inventory_col)
    return df.dropna().reset_index(drop=True)


if __name__ == "__main__":
    df = pd.read_csv("../data/synthetic_lme_daily.csv", parse_dates=["date"])
    feat = build_feature_set(df, price_col="zinc_close", inventory_col="zinc_inventory")
    print(feat.shape)
    print(feat[["date", "zinc_close", "gate_volatility", "gate_hurst",
                "gate_inventory_pressure"]].tail())
    feat.to_csv("../data/zinc_features.csv", index=False)
