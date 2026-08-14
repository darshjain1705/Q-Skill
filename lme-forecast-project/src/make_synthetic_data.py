"""
Generates a synthetic-but-realistic daily dataset for zinc & aluminium so the
rest of the pipeline (features -> experts -> gating network -> app) can be
built and tested end-to-end BEFORE real LME data is plugged in.

This is a development/testing aid only — replace with real data from
fetch_data.py before running any experiments you plan to report.
"""
import numpy as np
import pandas as pd
from pathlib import Path


def simulate_metal_series(n_days=1500, start_price=2500, seed=0,
                           regime_switch_prob=0.01, name="metal"):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2019-01-01", periods=n_days)

    # Regime-switching volatility + drift (mimics calm vs. volatile markets)
    regime = 0
    prices = [start_price]
    vols, drifts = [], []
    for _ in range(n_days - 1):
        if rng.random() < regime_switch_prob:
            regime = 1 - regime
        vol = 0.008 if regime == 0 else 0.025
        drift = 0.0002 if regime == 0 else rng.choice([-0.001, 0.0015])
        shock = rng.normal(drift, vol)
        prices.append(prices[-1] * (1 + shock))
        vols.append(vol)
        drifts.append(drift)

    price = np.array(prices)

    # Synthetic warehouse inventory: mean-reverting, loosely anti-correlated
    # with price changes (rising stocks -> price pressure down), matching
    # the real-world stylized fact used in the project's "inventory pressure" feature
    inv = [150000]
    for i in range(1, n_days):
        ret = price[i] / price[i - 1] - 1
        mean_revert = (150000 - inv[-1]) * 0.01
        inv.append(max(0, inv[-1] + mean_revert - ret * 200000 + rng.normal(0, 2000)))

    volume = rng.integers(5000, 20000, size=n_days)

    df = pd.DataFrame({
        "date": dates,
        f"{name}_close": price,
        f"{name}_volume": volume,
        f"{name}_inventory": inv,
    })
    return df


def main(outdir="../data"):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    zinc = simulate_metal_series(start_price=2900, seed=1, name="zinc")
    alu = simulate_metal_series(start_price=2400, seed=2, name="aluminium")

    df = zinc.merge(alu, on="date", how="inner")

    # Shared macro proxies (affect both metals, creating realistic co-movement)
    rng = np.random.default_rng(42)
    df["usd_index"] = 100 + np.cumsum(rng.normal(0, 0.1, size=len(df)))
    df["oil_price"] = 70 + np.cumsum(rng.normal(0, 0.3, size=len(df)))

    out_path = outdir / "synthetic_lme_daily.csv"
    df.to_csv(out_path, index=False)
    print(f"Synthetic dataset saved: {out_path} ({len(df)} rows)")
    return df


if __name__ == "__main__":
    main()
