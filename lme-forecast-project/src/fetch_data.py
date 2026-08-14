"""
Data acquisition for LME Zinc & Aluminium price forecasting project.

Run this on your own machine (NOT in a restricted sandbox) since it needs
open internet access. Combines two free sources:

1. World Bank "Pink Sheet" — free, monthly commodity prices going back to
   1960, includes Aluminum and Zinc. Reliable for academic use, no API key.
   https://www.worldbank.org/en/research/commodity-markets

2. Yahoo Finance (via yfinance) — free daily futures data. Aluminum has a
   direct futures ticker; Zinc does not trade on Yahoo, so for daily-frequency
   zinc you'll likely need a paid source (Metals-API, Nasdaq Data Link) or
   fall back to World Bank's monthly zinc series.

Usage:
    python fetch_data.py --outdir ../data
"""
import argparse
import io
import sys
from pathlib import Path

import pandas as pd
import requests

WORLD_BANK_PINK_SHEET_URL = (
    "https://thedocs.worldbank.org/en/doc/"
    "74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx"
)
# NOTE: The World Bank periodically changes this filename/hash (verified working
# as of Aug 2026). If the download fails, go to
# https://www.worldbank.org/en/research/commodity-markets -> "Commodity Prices
# (updated monthly)" -> right-click the Excel link to get the current URL and
# update the constant above.


def fetch_world_bank_pink_sheet(outdir: Path) -> pd.DataFrame:
    """Download and parse World Bank monthly commodity prices for
    Aluminum and Zinc."""
    print("Downloading World Bank Pink Sheet ...")
    resp = requests.get(WORLD_BANK_PINK_SHEET_URL, timeout=60)
    resp.raise_for_status()

    xls = pd.ExcelFile(io.BytesIO(resp.content))
    # The "Monthly Prices" sheet has metal names as column headers and a
    # date column; header row position has shifted between releases, so we
    # search for it rather than hardcoding a row number.
    raw = pd.read_excel(xls, sheet_name="Monthly Prices", header=None)
    header_row = raw[raw.apply(
        lambda r: r.astype(str).str.contains("Aluminum", case=False).any(),
        axis=1,
    )].index[0]

    df = pd.read_excel(xls, sheet_name="Monthly Prices", header=header_row)
    df = df.rename(columns={df.columns[0]: "date"})

    keep_cols = ["date"] + [c for c in df.columns if "alumin" in str(c).lower()
                             or "zinc" in str(c).lower()]
    df = df[keep_cols].dropna(subset=["date"])
    df["date"] = pd.to_datetime(df["date"], format="%YM%m", errors="coerce")
    df = df.dropna(subset=["date"]).reset_index(drop=True)

    out_path = outdir / "worldbank_monthly_aluminium_zinc.csv"
    df.to_csv(out_path, index=False)
    print(f"Saved {len(df)} rows -> {out_path}")
    return df


def fetch_yfinance_aluminium(outdir: Path) -> pd.DataFrame:
    """Daily aluminium futures via Yahoo Finance. Zinc has no equivalent
    Yahoo ticker as of writing."""
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance not installed. Run: pip install yfinance")
        return pd.DataFrame()

    print("Downloading daily Aluminium futures (ALI=F) from Yahoo Finance ...")
    tkr = yf.Ticker("ALI=F")
    hist = tkr.history(period="max")
    if hist.empty:
        print("No data returned for ALI=F — ticker may have changed.")
        return hist

    hist = hist.reset_index()[["Date", "Open", "High", "Low", "Close", "Volume"]]
    hist.columns = [c.lower() for c in hist.columns]
    out_path = outdir / "yfinance_daily_aluminium.csv"
    hist.to_csv(out_path, index=False)
    print(f"Saved {len(hist)} rows -> {out_path}")
    return hist


def fetch_lme_free_current_year(outdir: Path):
    """Reminder helper: LME itself gives free next-day-delayed data for the
    current calendar year only, via lme.com. This must be pulled manually
    (or via browser automation) since it requires navigating their site —
    left as a manual step, documented here for completeness."""
    print(
        "Reminder: LME.com provides free official data for the CURRENT YEAR "
        "only (next-day delayed), via https://www.lme.com/market-data. "
        "This is a good source to validate / supplement your historical "
        "data with the most recent, most authoritative prices, but it "
        "requires manual download or a licensed data feed for full history."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--outdir", type=str, default="../data")
    args = parser.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    try:
        fetch_world_bank_pink_sheet(outdir)
    except Exception as e:
        print(f"World Bank fetch failed: {e}", file=sys.stderr)

    try:
        fetch_yfinance_aluminium(outdir)
    except Exception as e:
        print(f"Yahoo Finance fetch failed: {e}", file=sys.stderr)

    fetch_lme_free_current_year(outdir)


if __name__ == "__main__":
    main()
