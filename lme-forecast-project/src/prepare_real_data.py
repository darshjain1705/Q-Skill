"""
Merge raw downloaded real-data files into the pipeline's expected schema
and produce a 5-year working slice alongside the full-history file.

WHY THIS SCRIPT EXISTS: fetch_data.py gives you raw files with different
column names, frequencies (monthly vs daily), and date formats depending
on the source. Nothing else in the pipeline (features.py, train.py,
app.py) understands those raw formats -- they all expect a single merged
CSV with columns: date, {metal}_close, {metal}_volume, {metal}_inventory
(same convention as data/synthetic_lme_daily.csv).

USAGE (edit the CONFIG section below to match whatever you actually
downloaded, then run):

    cd src
    python prepare_real_data.py

WHAT YOU NEED TO FILL IN before this will work on your real files:
  1. Set WORLD_BANK_XLSX_PATH to wherever fetch_data.py saved it
     (data/worldbank_monthly_aluminium_zinc.csv).
  2. Set ALUMINIUM_DAILY_PATH to your daily aluminium source
     (data/yfinance_daily_aluminium.csv from fetch_data.py, or your own).
  3. Set ZINC_DAILY_PATH if you found a daily zinc source (Metals-API
     etc). If you don't have one, leave as None -- the script will fall
     back to forward-filling the World Bank *monthly* zinc series to
     daily frequency, and will print a warning reminding you to disclose
     this in your methodology section.
  4. Inventory data: LME warehouse stock reports aren't bundled with any
     of the free sources above. If you haven't sourced real inventory
     data yet, this script will leave the inventory columns as NaN and
     print a warning -- features.py's inventory_pressure_index() will
     fail on NaN inventory, so you MUST have real inventory data (or
     consciously decide to keep using the synthetic inventory series as
     a placeholder within a real-price dataset -- unusual, but better
     than nothing while you source real stock data) before running the
     rest of the pipeline.
"""
from pathlib import Path
import warnings

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------
# CONFIG -- edit these paths to match your actual downloaded files
# ---------------------------------------------------------------------
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

WORLD_BANK_MONTHLY_PATH = DATA_DIR / "worldbank_monthly_aluminium_zinc.csv"
ALUMINIUM_DAILY_PATH = DATA_DIR / "yfinance_daily_aluminium.csv"
ZINC_DAILY_PATH = None  # e.g. DATA_DIR / "metals_api_daily_zinc.csv"
INVENTORY_PATH = None   # e.g. DATA_DIR / "lme_warehouse_stocks.csv"

OUTPUT_FULL_HISTORY = DATA_DIR / "real_lme_daily_full_history.csv"
OUTPUT_5YR_SLICE = DATA_DIR / "real_lme_daily_5yr.csv"

YEARS_FOR_SLICE = 5


def load_worldbank_monthly(path: Path) -> pd.DataFrame:
    if not path.exists():
        warnings.warn(f"World Bank file not found at {path} -- skipping.")
        return pd.DataFrame()
    df = pd.read_csv(path, parse_dates=["date"])
    # World Bank column names vary release to release (e.g. "Aluminum",
    # "Zinc" with unit suffixes) -- normalize by substring match rather
    # than exact match, matching the approach fetch_data.py already uses.
    alu_col = next((c for c in df.columns if "alumin" in c.lower()), None)
    zinc_col = next((c for c in df.columns if "zinc" in c.lower()), None)
    out = pd.DataFrame({"date": df["date"]})
    if alu_col:
        out["aluminium_close_monthly"] = df[alu_col]
    if zinc_col:
        out["zinc_close_monthly"] = df[zinc_col]
    return out


def load_daily_ohlc(path: Path, metal: str) -> pd.DataFrame:
    """Loads a daily OHLCV-style file (yfinance format) and renames to
    the pipeline's {metal}_close / {metal}_volume convention."""
    if path is None or not Path(path).exists():
        return pd.DataFrame()
    df = pd.read_csv(path)
    date_col = next((c for c in df.columns if c.lower() in ("date", "datetime")), df.columns[0])
    df["date"] = pd.to_datetime(df[date_col]).dt.tz_localize(None)
    close_col = next((c for c in df.columns if c.lower() == "close"), None)
    vol_col = next((c for c in df.columns if c.lower() == "volume"), None)
    out = pd.DataFrame({"date": df["date"]})
    out[f"{metal}_close"] = df[close_col] if close_col else np.nan
    out[f"{metal}_volume"] = df[vol_col] if vol_col else np.nan
    return out


def monthly_to_daily_ffill(monthly_df: pd.DataFrame, value_col: str, out_col: str,
                            daily_index: pd.DatetimeIndex) -> pd.Series:
    """Forward-fills a monthly series onto a daily index. Used as the
    documented fallback for zinc if no daily source is available."""
    s = monthly_df.set_index("date")[value_col].reindex(daily_index, method="ffill")
    s.name = out_col
    return s


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    wb = load_worldbank_monthly(WORLD_BANK_MONTHLY_PATH)
    alu_daily = load_daily_ohlc(ALUMINIUM_DAILY_PATH, "aluminium")
    zinc_daily = load_daily_ohlc(ZINC_DAILY_PATH, "zinc") if ZINC_DAILY_PATH else pd.DataFrame()

    if alu_daily.empty and wb.empty:
        raise SystemExit(
            "No data sources found. Run fetch_data.py first, or check the "
            "CONFIG paths at the top of this script."
        )

    # Build the daily calendar off whichever daily source we have (prefer
    # aluminium daily; fall back to World Bank's monthly dates upsampled
    # to business days).
    if not alu_daily.empty:
        daily_index = pd.bdate_range(alu_daily["date"].min(), alu_daily["date"].max())
    else:
        daily_index = pd.bdate_range(wb["date"].min(), wb["date"].max())

    merged = pd.DataFrame({"date": daily_index})

    if not alu_daily.empty:
        merged = merged.merge(alu_daily, on="date", how="left")
    elif not wb.empty and "aluminium_close_monthly" in wb.columns:
        merged["aluminium_close"] = monthly_to_daily_ffill(
            wb, "aluminium_close_monthly", "aluminium_close", daily_index
        ).values
        merged["aluminium_volume"] = np.nan
        warnings.warn(
            "No daily aluminium source found -- forward-filled from World Bank "
            "MONTHLY data. Disclose this in your methodology section if used "
            "for real experiments."
        )

    if not zinc_daily.empty:
        merged = merged.merge(zinc_daily, on="date", how="left")
    elif not wb.empty and "zinc_close_monthly" in wb.columns:
        merged["zinc_close"] = monthly_to_daily_ffill(
            wb, "zinc_close_monthly", "zinc_close", daily_index
        ).values
        merged["zinc_volume"] = np.nan
        warnings.warn(
            "No daily zinc source configured (ZINC_DAILY_PATH is None) -- "
            "forward-filled from World Bank MONTHLY zinc data. This means "
            "your zinc 'daily' series only actually updates ~12x/year. "
            "MUST disclose this as a limitation in your paper if used for "
            "real experiments -- source a real daily zinc feed (Metals-API "
            "etc) before drawing strong conclusions from zinc results."
        )

    # Inventory -- no free bundled source; left as NaN with a loud warning
    # until you plug in real LME warehouse stock data.
    for metal in ("zinc", "aluminium"):
        col = f"{metal}_inventory"
        if INVENTORY_PATH is not None and Path(INVENTORY_PATH).exists():
            inv_df = pd.read_csv(INVENTORY_PATH, parse_dates=["date"])
            inv_col = next((c for c in inv_df.columns if metal in c.lower()), None)
            if inv_col:
                merged = merged.merge(
                    inv_df[["date", inv_col]].rename(columns={inv_col: col}),
                    on="date", how="left",
                )
                merged[col] = merged[col].ffill()
                continue
        merged[col] = np.nan

    if merged.filter(like="_inventory").isna().all().all():
        warnings.warn(
            "No real inventory data found (INVENTORY_PATH is None or file "
            "missing). features.py's inventory_pressure_index() cannot run "
            "on NaN inventory. Source real LME warehouse stock data "
            "(https://www.lme.com/en/Market-data/LME-warehouse-and-stocks-data) "
            "and set INVENTORY_PATH before running features.py on this output."
        )

    merged = merged.sort_values("date").reset_index(drop=True)
    merged.to_csv(OUTPUT_FULL_HISTORY, index=False)
    print(f"Saved full-history merged dataset: {OUTPUT_FULL_HISTORY} ({len(merged)} rows, "
          f"{merged['date'].min().date()} -> {merged['date'].max().date()})")

    cutoff = merged["date"].max() - pd.DateOffset(years=YEARS_FOR_SLICE)
    sliced = merged[merged["date"] >= cutoff].reset_index(drop=True)
    sliced.to_csv(OUTPUT_5YR_SLICE, index=False)
    print(f"Saved {YEARS_FOR_SLICE}-year slice: {OUTPUT_5YR_SLICE} ({len(sliced)} rows, "
          f"{sliced['date'].min().date()} -> {sliced['date'].max().date()})")
    print("\nUse OUTPUT_5YR_SLICE as your primary dataset for features.py / train.py, "
          "and OUTPUT_FULL_HISTORY for a robustness check across the longer history.")


if __name__ == "__main__":
    main()
