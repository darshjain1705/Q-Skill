# LME Zinc & Aluminium Forecasting — Routing vs. Representation

A one-semester research project on forecast combination for LME base metals.

**The research question changed.** It began as "does a warehouse-inventory-pressure
signal improve a gated Mixture-of-Experts ensemble?" A code-level audit found that
the pipeline could not answer that question — the experts never saw the signal under
any condition, so a null result was uninterpretable — and that the gate was
mathematically incapable of adapting. The question is now:

> **Should a fundamental signal inform the forecast, or the choice of forecaster?**

See `../docs/lme-forecast-project-audit.md` for the audit of the original code and
`../docs/routing-vs-representation.md` for the new design and its results.

---

## Quickstart

```bash
pip install -r requirements.txt

cd src
python synthetic_regime.py          # build the controlled testbed
python experiment.py --metal aluminium
```

To regenerate every number quoted in the documentation (~20 min):

```bash
cd src && python reproduce.py       # writes to ../results/
```

---

## Project structure

```
lme-forecast-project/
├── data/                      generated + downloaded datasets
├── results/                   output of reproduce.py (tables + run log)
├── src/
│   ├── synthetic_regime.py    controlled testbed with known ground-truth routing
│   ├── featureset.py          return-target features; expert/gate column partition
│   ├── expert_panel.py        four experts behind one interface
│   ├── oof.py                 blocked out-of-fold predictions for honest supervision
│   ├── gating.py              static / gated / oracle / clustered combiners
│   ├── metrics.py             MASE, RelMAE, Diebold-Mariano, gate diagnostics
│   ├── experiment.py          the 2x2, controls, and the gain decomposition
│   ├── reproduce.py           regenerates every documented number
│   │
│   ├── fetch_data.py          World Bank + Yahoo Finance download (needs internet)
│   ├── prepare_real_data.py   merges raw downloads into the pipeline schema
│   │
│   ├── features.py            ORIGINAL level-target features (superseded)
│   ├── experts.py             ORIGINAL expert classes (superseded)
│   ├── train.py               ORIGINAL level-target pipeline (superseded)
│   └── make_synthetic_data.py ORIGINAL random-walk generator (superseded)
├── app/app.py                 Streamlit demo
└── paper/                     proposal + drafts
```

The four modules marked *superseded* are kept so the audit's findings remain
reproducible against the code they describe. New work should use the modules above
them.

---

## The experimental design

All four conditions share one feature frame, one set of folds, and one `dropna`, so
they differ **only** in which columns each component is allowed to read.

|                     | Gate without inventory | Gate with inventory |
|---------------------|------------------------|---------------------|
| **Experts without** | (a) neither            | (c) routing only    |
| **Experts with**    | (b) representation     | (d) both            |

### Controls

Three, all absent from the original design and all load-bearing:

- **Random walk** — the real benchmark for a return forecast. Everything is reported
  relative to it.
- **Static NNLS combiner** — one fixed weight vector. If the gate cannot beat this,
  "dynamic" bought nothing regardless of how it compares to single experts.
- **Oracle router** — routes on ground-truth regime labels. Not a competitor, an
  upper bound. Without it, "the gate did not help" cannot be distinguished from
  "there was nothing to exploit".

Every combiner is trained on out-of-fold expert predictions. Every comparison carries
a Diebold–Mariano test.

---

## Headline result

On the controlled testbed, regime-conditional combination genuinely beats static
combination — 1.6% on zinc, 3.5% on aluminium, both significant. **No learned router
captures it.** The decomposition shows why:

```
                          classifier acc    oracle gain    retained by best learned
zinc                          0.675          1.56%              11%
aluminium                     0.779          3.52%              40%
```

Regime misclassification alone consumes most of the available gain, even holding the
regime-conditional weights perfect. The inventory signal — which predicts the next
regime at AUC 0.85–0.90 — is not the bottleneck. Identification accuracy is.

**These numbers are from the synthetic testbed.** It exists to establish that the
machinery works and that the failure mode is real. It is a prerequisite for the
real-data experiment, not a substitute for it.

---

## Defects fixed (each reproduced numerically)

| Defect | Evidence | Fix |
|---|---|---|
| Double `softmax` in the gate | Weights collapsed to a constant `[0.564, 0.219, 0.217]`, matching `softmax([1,0,0])` | Regress onto log-weights, softmax at inference |
| Gate supervised on in-sample expert predictions | Boosting: 11.85 MAE in-sample → 576.37 out-of-sample; oracle gave it weight 0.97 | Blocked out-of-fold predictions (`oof.py`) |
| `early_stopping=True` on short windows | Routing agreement fell to 0.100 — worse than chance | Off by default; regularize with `alpha` |
| Unscaled MLP target | Log returns ~1e-2; sequence expert scored 0.049 vs 0.010 for others | `TransformedTargetRegressor` |
| Price levels as the target | Made every metric a persistence contest | Target is next-day log return |
| `ARIMAExpert` never imported | Absent from every reported result | Wired into `expert_panel.py` |
| Third "expert" was `shift(1)` | Identical to the benchmark it competed against | Removed from the panel |

---

## Still missing before real experiments

1. **LME warehouse inventory.** The signal the whole question rests on. Not bundled
   with any free source — see
   <https://www.lme.com/en/Market-data/LME-warehouse-and-stocks-data>.
   `prepare_real_data.py` warns loudly rather than silently guessing.
2. **Daily zinc prices.** No free daily source. Metals-API, Nasdaq Data Link, or
   institutional access — or a conscious decision to run zinc monthly and disclose it.
   Forward-filling monthly prices to a daily index produces a series that updates
   twelve times a year and must not be presented as daily.
3. **A regime model for real data.** The testbed has ground-truth labels; real data
   does not. Fit a Markov-switching model on the training window only, so the oracle
   bound becomes estimated rather than exact — and report sensitivity to it.

---

## Placeholders

- **SequenceExpert** is an MLP over the lagged-return block, not an LSTM. The
  `fit`/`predict` interface makes a PyTorch replacement a genuine drop-in.
- **Inventory-pressure weights** (0.5/0.3/0.2) are now a parameter of
  `featureset.inventory_pressure_index` rather than three literals in the body, so
  they can be swept as a robustness check instead of asserted.
