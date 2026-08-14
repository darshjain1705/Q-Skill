# LME Zinc & Aluminium Forecasting — Regime/Inventory-Conditioned Gated Mixture-of-Experts

A 3-credit, one-semester research project: a novel gating architecture that
dynamically combines multiple forecasting models ("experts") for LME zinc
and aluminium prices, with the gate conditioned on market regime and a
custom warehouse-inventory-pressure index.

## Project structure

```
lme-forecast/
├── data/                    # raw + processed data (gitignored in practice)
├── src/
│   ├── fetch_data.py        # pulls World Bank + Yahoo Finance data (run locally, needs internet)
│   ├── make_synthetic_data.py  # generates fake-but-realistic data for pipeline testing
│   ├── features.py          # lag features + regime detection + inventory-pressure index (NOVEL)
│   ├── experts.py           # ARIMA / XGBoost / Sequence base forecasters
│   ├── gating.py            # the gating network (NOVEL — core contribution)
│   └── train.py             # full pipeline: train, evaluate, ablate
├── app/
│   └── app.py               # Streamlit demo app
├── paper/                   # write-up drafts go here
└── requirements.txt
```

## Setup

```bash
pip install -r requirements.txt
```

## Quickstart (synthetic data, works offline)

```bash
cd src
python make_synthetic_data.py --outdir ../data
python features.py            # builds zinc_features.csv
# repeat for aluminium by editing the price_col/inventory_col at the bottom of features.py
python train.py                # trains experts + gate, prints comparison table
cd ../app
streamlit run app.py
```

## Recent changes (Aug 2026)

- `src/fetch_data.py`: World Bank download URL updated to the current
  working link (verified Aug 2026). This will go stale again eventually —
  see the note in the file for how to refresh it.
- `src/train.py`: **rewritten** to do expanding-window walk-forward
  backtesting (6 folds by default) instead of a single static train/test
  split, matching what Section 4.3 of the proposal promises. Run it the
  same way (`python train.py`); it now also prints per-fold MAE so you
  can see whether the gated model is stable across different time periods
  / regimes, and reports directional accuracy alongside MAE/RMSE.
- `src/prepare_real_data.py`: **new**. Once you've run `fetch_data.py` (or
  sourced data manually — e.g. Metals-API for daily zinc, LME's site for
  warehouse inventory), edit the CONFIG section at the top of this file to
  point at your downloaded files, then run it. It merges everything into
  the pipeline's expected schema (`date`, `{metal}_close`,
  `{metal}_volume`, `{metal}_inventory`), and produces both a full-history
  file and a 5-year working slice. It will loudly warn (not silently
  guess) if daily zinc or inventory data is missing, since both are
  currently unsolved gaps — see "What's still missing" below.

## What's still missing before you can run real experiments

1. **Daily zinc prices.** No free daily source exists (see
   `fetch_data.py`'s docstring). You need Metals-API, Nasdaq Data Link, or
   institutional Bloomberg/Refinitiv access — or consciously accept
   monthly-frequency zinc and disclose it as a limitation.
2. **Warehouse inventory data**, which the entire "novel feature" of this
   project depends on. Not bundled in any of the free sources above.
   Check https://www.lme.com/en/Market-data/LME-warehouse-and-stocks-data.
   `prepare_real_data.py` will produce NaN inventory columns and warn
   loudly until this is sourced — `features.py` cannot compute the
   inventory-pressure index on NaN data.

## Moving to real data

1. Run `src/fetch_data.py` **on a machine with open internet access** (this
   pulls World Bank Pink Sheet monthly data + Yahoo Finance daily aluminium
   futures). Update the `WORLD_BANK_PINK_SHEET_URL` constant if the World
   Bank has rotated their file link (check
   https://www.worldbank.org/en/research/commodity-markets).
2. For daily-frequency zinc (Yahoo Finance doesn't carry it), evaluate a
   paid source: [Metals-API](https://metals-api.com) has zinc back to 2008
   with a free/trial tier, or check your institution's Bloomberg/Refinitiv
   access if available.
3. For inventory data specifically (needed for the inventory-pressure
   index), LME publishes daily warehouse stock reports — check
   https://www.lme.com/en/Market-data/LME-warehouse-and-stocks-data for
   current access options.
4. Replace `data/synthetic_lme_daily.csv` with your real merged dataset
   (same column naming convention: `{metal}_close`, `{metal}_volume`,
   `{metal}_inventory`) and rerun the pipeline above.

## What's a placeholder vs. what's real

- **SequenceExpert** is currently an MLP over flattened lag windows, not a
  true LSTM — this sandbox couldn't fit PyTorch on disk. Swap it for a real
  LSTM/GRU (PyTorch) once you're on your own machine; the interface
  (`.fit()` / `.predict()`) is designed as a drop-in replacement so nothing
  else in the pipeline needs to change.
- **Gating network training** uses an "oracle-supervised" approach (train
  the gate to imitate inverse-trailing-error weighting) rather than fully
  joint end-to-end backprop through experts + gate. This is a legitimate,
  citable design choice, but if you want the strongest version for the
  paper, the natural extension is end-to-end joint training in PyTorch —
  documented as future work either way.
- **Inventory-pressure index formula** (`features.py`) is a first-draft
  formulation — you'll want to justify/tune the weighting (0.5/0.3/0.2)
  and possibly test alternative formulations as a robustness check in the
  paper.

## Ablations already wired up in train.py

- Full gated model vs. simple average ensemble vs. best single expert vs.
  naive persistence baseline
- Gated model **with** vs. **without** the inventory-pressure signal in
  the gate's state vector (this is your key "does the novel feature
  matter" result)

Next to add as you go: with/without regime (Hurst) signal, gate weight
visualization overlaid on known historical volatility events, and
cross-metal (zinc+aluminium joint) gating as a stretch goal.
