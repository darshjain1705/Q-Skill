# LME Forecast Project — Work Assessment & Publication Readiness

**Subject:** `lme-forecast-project` — a regime- and inventory-conditioned gated
Mixture-of-Experts forecaster for LME zinc and aluminium prices.

**Reviewed:** 14 Aug 2026 · 1,038 lines of Python across 8 modules · pipeline
executed end-to-end on both metals · each blocking defect reproduced in isolation.

**Headline:** ≈40% complete against the 15-week plan. Not publishable as it stands
— the central claim is currently contradicted by the project's own output. Three
confirmed blocking defects explain most of that, and all three are fixable in days.

---

## 1. The short version

The engineering is better than most semester projects at this stage. The
walk-forward backtest harness is properly built, the features are causal, the
module interfaces are clean, and the README is unusually honest about what is real
and what is a placeholder. That is genuine, reusable work.

But when the pipeline is actually run, it reports that **the gated Mixture-of-Experts
loses to a naive persistence baseline by a factor of 4.6×**, loses to its own best
single expert, and that removing the inventory-pressure signal — the project's
headline novelty — *improves* zinc accuracy slightly. On aluminium the sign flips,
which tells you the difference is noise.

The most consequential defect is that the gating network is **mathematically
prevented from adapting**: a second `softmax` is applied to an output that is
already a probability vector, flattening every prediction toward a constant. The
"dynamic, regime-adaptive gate" is, in the current code, a fixed weighted average.

None of this is fatal. It does mean the current results cannot go in a paper, and
that the honest completion figure is closer to 40% than the file listing suggests.

---

## 2. What the pipeline actually reports

Bundled synthetic data · 6-fold expanding-window walk-forward · metrics pooled
across folds · lower MAE is better.

### Zinc

| Model | MAE | RMSE | Dir. acc. | Reading |
|---|---:|---:|---:|---|
| **naive (persistence)** | **42.62** | **59.96** | 0.008 | Baseline wins outright |
| boosting_only | 174.02 | 288.06 | 0.526 | Best learned model |
| gated_moe_no_inventory_signal | 195.73 | 361.87 | 0.517 | Ablated gate |
| **gated_moe** | **196.21** | **363.94** | 0.517 | Proposed model — 4.6× worse than naive |
| simple_avg | 221.66 | 507.95 | 0.502 | Unweighted ensemble |
| sequence_only | 574.27 | 1473.24 | 0.509 | MLP stand-in for the LSTM |

### Aluminium

| Model | MAE | RMSE | Dir. acc. | Reading |
|---|---:|---:|---:|---|
| **naive (persistence)** | **38.28** | **52.29** | 0.008 | Baseline wins outright |
| boosting_only | 81.15 | 132.99 | 0.546 | Best learned model |
| **gated_moe** | **84.02** | **125.97** | 0.551 | Proposed model — 2.2× worse than naive |
| gated_moe_no_inventory_signal | 84.64 | 126.79 | 0.552 | Ablated gate — effect flips sign vs. zinc |
| simple_avg | 94.64 | 164.54 | 0.538 | Unweighted ensemble |
| sequence_only | 228.48 | 459.90 | 0.533 | MLP stand-in for the LSTM |

Two things beyond the ranking:

- The key ablation moves MAE by **0.48 on zinc and 0.62 on aluminium**, on base
  values of 196 and 84, in *opposite directions*. That is noise, and no
  significance test is computed to establish otherwise.
- The naive baseline's directional accuracy of **0.008** is a broken metric.
  Persistence predicts zero change, so `sign(y_prev − y_prev) = 0`, which never
  equals `±1`. The comparison is structurally unwinnable for the baseline.

---

## 3. Three confirmed defects

### 3.1 BLOCKING — the gate cannot adapt (`src/gating.py:76`)

The MLP is trained to regress onto oracle weight vectors that already sum to 1.
`predict_weights()` then passes that output through `softmax()` a second time.
Softmax over values confined to [0,1] compresses everything toward uniform, so the
gate emits a near-constant weight vector regardless of market state.

```
oracle weight targets   mean [0.9665 0.0179 0.0156]  std [0.106 0.084 0.054]
raw MLP gate output     mean [0.9659 0.0296 0.0117]  sums to 1.007  <- already valid weights
after the 2nd softmax   mean [0.5625 0.2208 0.2167]  std [0.014 0.012 0.009]

softmax([1, 0, 0])      = [0.5761 0.2119 0.2119]   <- the collapse target
observed pooled weights = [0.5640 0.2190 0.2170]   <- matches to 2 decimals
```

Across all six folds the gate's weight standard deviation over time is
**0.027 / 0.019 / 0.011**. The architecture's defining property — input-conditioned
weighting — is not present in the running system. Any "gate weights over time"
figure produced today shows a flat line with numerical jitter.

**Fix:** drop the second `softmax`; clip negatives and renormalise by the sum.

### 3.2 BLOCKING — the gate is supervised on in-sample expert predictions (`src/train.py:42–66`)

Oracle weights are computed from each expert's error on the *training* data, where
the boosting expert has partly memorised the target. The gate therefore learns to
trust whichever expert overfits hardest — precisely the wrong one out of sample.

```
                  in-sample     out-of-sample     degradation
boosting              11.85            576.37          48.6x
sequence              33.64            428.81          12.7x
momentum / naive      31.70             43.95           1.4x

oracle weight assigned to boosting: 0.97   (worst expert out of sample)
oracle weight assigned to naive:    0.02   (best expert out of sample)
```

This inverts the gate's preference ordering. Even with the softmax bug fixed, the
gate would confidently select the worst forecaster.

**Fix:** generate expert predictions for gate training out-of-fold — an inner
blocked/rolling split inside each outer training window — so the oracle sees
honest errors.

### 3.3 MAJOR — forecasting price levels makes every metric a persistence contest (`src/train.py:158–176`)

The target is `{metal}_close` in currency units and the features are lagged prices.
Every model is implicitly learning to reproduce yesterday's price, and MAE on levels
is dominated by how closely it does so. This is why the naive baseline wins by 4.6×,
and why the softmax temperature of 1.0 saturates — errors in tens-to-hundreds of
currency units make `softmax(−error)` effectively one-hot.

It also makes the results incomparable to the forecasting literature, which reports
skill *relative to* a random walk on returns, not raw level error.

**Fix:** forecast log-returns or Δprice; report MASE or RMSSE alongside MAE; add a
Diebold–Mariano test against the random walk; scale the oracle temperature to the
error distribution rather than fixing it at 1.0.

### A diagnostic worth sitting with

The synthetic inventory series in `make_synthetic_data.py:42` is constructed as a
direct function of returns (`inv[t] ≈ inv[t−1] − ret × 200000`). On this data the
inventory-pressure index is informative *by construction* — a lightly disguised
copy of the return series. The ablation still shows no gain.

That is strong evidence the gating machinery is broken rather than the feature being
weak, which is encouraging. It also means no ablation result on synthetic data can
ever support the paper's claim, however it comes out.

---

## 4. Full defect register

| Severity | Location | Issue |
|---|---|---|
| Blocking | `data/` | No real data anywhere. Daily zinc prices and LME warehouse stocks — the two inputs the novelty depends on — are both unsourced. `fetch_data.py` has never been successfully run in-repo. |
| Major | `src/train.py:27` | `ARIMAExpert` is written but never imported into the pipeline. Proposal Expert A is absent from every reported result. |
| Major | `src/train.py:55` | The third "expert" is `shift(1)` — identical to the naive baseline it is benchmarked against. The ensemble competes against one of its own members. |
| Major | `src/features.py:87` | `build_gate_state_vector` accepts `expert_error_cols`, but `build_feature_set` never passes it. The gate sees 3 features; the proposal's *s_t* specifies rolling expert errors too. |
| Major | `src/train.py:69` | Only 2 of 3 planned ablations exist. The regime/Hurst ablation from §4.3(iii) is unimplemented. |
| Major | `src/train.py:139` | No significance testing. Sub-1% MAE deltas are reported as ablation outcomes with no Diebold–Mariano, bootstrap CI, or Model Confidence Set. |
| Minor | `app/app.py:49` | The demo uses a static 80/20 split while `train.py` uses walk-forward. Demo numbers will not match paper numbers. |
| Minor | `app/app.py:105` | Expert names are hardcoded in the weight chart; adding or reordering experts silently mislabels the plot. |
| Minor | `src/features.py:100` | Metal is hardcoded in `__main__`; the README instructs editing the file by hand per metal. Should be a CLI argument. |
| Minor | `src/train.py:90` | `refit_every` is accepted and documented but never used — dead parameter in the public signature. |

---

## 5. Completion against the proposal's timeline

| Weeks | Phase | Done | What is missing |
|---|---|---:|---|
| 1–2 | Literature review | 20% | Zero citations compiled. The proposal says so itself. The novelty claim is therefore unverified. |
| 3–4 | Data pipeline | 35% | Fetch and merge code written and readable, but never run against live sources. No real prices, no inventory, no EDA. |
| 5–6 | Base experts | 55% | ARIMA unused; LSTM is an MLP stand-in; third expert is the baseline. No baseline performance table on real data. |
| 7–9 | Gating network | 50% | Runs, but is provably non-adaptive and trained on leaked in-sample errors. No mathematical formalisation written up. |
| 10–11 | Training & ablations | 40% | Harness is genuinely good. Results are negative, on synthetic data, untested for significance, and one ablation short. |
| 12–13 | Streamlit demo | 65% | Three charts and a metric, working. Split logic diverges from the backtest; no regime overlay or ablation view. |
| 14–15 | Paper draft | 5% | Not started. `paper/` contains the proposal and its build script only. |

Week-weighted, that is **≈40% of the plan**. Worth splitting, though: the *software*
is roughly 70% built, while the *research* — a defensible result on real data,
tested for significance, written up — is closer to 15%. Weeks 10 through 15 all
depend on data that does not exist yet.

---

## 6. Is this worth a conference paper?

**Not as it stands, and the reason is not the code quality.**

### Four things a reviewer would reject on today

1. **No real data.** Every number comes from a random-walk simulator whose inventory
   series is generated *from* the returns. No claim about metals markets can be
   supported by it.
2. **The result contradicts the thesis.** The proposed model loses to persistence
   and to its own best expert, on both metals.
3. **The novel component shows no effect.** The inventory ablation moves MAE by well
   under 1% and flips sign between metals, with no significance test.
4. **The novelty claim is unverified.** "No published work combines learned gating
   with inventory signals for LME metals" is asserted with zero citations compiled.

### The novelty claim needs narrowing before it is defended

This is the point most worth raising with the guide. The mechanism implemented here
— train a meta-learner to predict combination weights for a pool of forecasters from
meta-features including their trailing errors — is an established family, not a new
one. Feature-based forecast combination via meta-learning and arbitrated dynamic
ensembles both do exactly this, and the latter is a well-known time-series result. A
reviewer in this area will know them.

What is actually new here is narrower: **adding a purpose-built warehouse-inventory-
pressure index to the meta-learner's input, for LME base metals.** That is a
legitimate contribution, but it is a feature-engineering contribution inside a known
architecture, not a new architecture. Claiming the architecture as the contribution
invites a desk reject; claiming the signal, and evidencing it properly with the
ablation, is defensible.

This raises the stakes on the ablation: if the inventory signal is the contribution,
the with/without comparison *is* the paper, and it needs real inventory data and a
significance test to mean anything.

### Where it could realistically land, if the work is finished

- **Realistic:** applied-AI-in-finance venues and their workshop or poster tracks;
  forecasting symposia that welcome student work; regional IEEE conferences. Applied
  journals in this space — commodity/resources policy, forecasting, expert-systems
  titles — routinely publish work of this shape, though they have grown stricter
  about "another ensemble on commodity X".
- **Not realistic:** top-tier ML main tracks. Two commodity series, ~1,500
  observations, and a known combination mechanism will not clear that bar regardless
  of execution.

### The honest opportunity

Base metals are close to efficient at daily frequency, and it is entirely possible
that after every fix the gated model still does not beat a random walk. That outcome
is *not* a failed project. A careful negative result — "regime- and
inventory-conditioned gating does not improve on a random walk for LME zinc and
aluminium, and here is the diagnostic evidence for why the gate collapses" — is
publishable at a workshop, is far more defensible than a fragile positive, and is
the paper this codebase is currently best positioned to write.

The diagnostic work in this audit is itself the seed of that paper: a reproducible
demonstration that oracle-supervised gating trained on in-sample expert errors
systematically selects the most overfit expert is a finding other people building
these systems would want to read.

---

## 7. What is left, in order

The first four items are the critical path; nothing downstream is worth doing before
they land.

1. **Fix the three blocking defects.** Remove the double softmax; train the gate on
   out-of-fold expert predictions; switch the target to log-returns and scale the
   oracle temperature to the error distribution. Then re-run and see what the
   architecture actually does when allowed to work.
   *Est. 2–4 days · unblocks every result in the paper.*

2. **Source real inventory data.** The single highest-risk item, and the one the
   whole novelty claim rests on. LME warehouse stock reports are the target; if full
   history cannot be obtained, decide early whether to scope the paper to whatever
   window *is* available and disclose it, rather than discovering the constraint in
   week 14.
   *Est. 1–2 weeks, mostly waiting on access · hard blocker.*

3. **Source daily zinc prices, or re-scope.** A trial-tier metals data feed,
   institutional terminal access, or a conscious decision to run zinc at monthly
   frequency and say so. Forward-filling monthly prices to a daily index — which
   `prepare_real_data.py` will do and warn about — produces a series that updates
   twelve times a year and must not be presented as daily.
   *Est. 2–5 days · hard blocker for the zinc half.*

4. **Compile the literature review.** Weeks 1–2 of the plan, still outstanding, and
   it determines what the paper is allowed to claim. Engage directly with
   meta-learned forecast combination and arbitrated dynamic ensembles, and with
   existing inventory- and convenience-yield-based metals forecasting, then restate
   the contribution in terms of what survives.
   *Est. 1 week · determines the framing of everything else.*

5. **Complete the expert panel.** Wire `ARIMAExpert` into the pipeline, swap the MLP
   stand-in for a real LSTM or GRU now that disk constraints no longer apply, and
   replace the momentum expert with something that is not identical to the baseline.
   *Est. 3–5 days.*

6. **Build the evaluation the paper needs.** Diebold–Mariano against the random
   walk, bootstrap confidence intervals on every ablation delta, MASE alongside MAE,
   a corrected directional-accuracy metric, and the missing regime ablation. Add
   gate-weight entropy over time as direct evidence that the gate is
   input-conditioned.
   *Est. 1 week.*

7. **Re-run everything on real data and write it up.** Full walk-forward on both
   metals, all three ablations, per-regime breakdowns, and the gate-weight
   visualisation overlaid on known volatility events. Then the draft — and be
   prepared for the result to be negative, because that draft is still worth writing.
   *Est. 2–3 weeks.*

---

## 8. What is genuinely good here

Worth stating plainly, because the defect list above is long and the underlying work
does not deserve to be read as weak.

- The **walk-forward backtest harness** is properly constructed — expanding window,
  metrics pooled across folds rather than averaged over them, per-fold reporting for
  stability inspection, and a clear error when the fold size gets too small to be
  meaningful. Many published papers in this area do worse.
- The **feature engineering is causal.** Every rolling window and z-score looks
  backwards only. There is no lookahead leakage in `features.py`, which is the most
  common silent error in this kind of project.
- The **module interfaces are clean.** The `fit`/`predict` contract means the LSTM
  swap really is a drop-in, exactly as the README claims.
- `prepare_real_data.py` **warns loudly instead of silently guessing** when inventory
  or daily zinc is missing. That instinct — refusing to fabricate a plausible-looking
  dataset — is the right one and is rarer than it should be.
- The **README is candid** about which components are placeholders. That honesty is
  what made this audit fast, and it is the same disposition the paper will need.

---

*Prepared from a full read of all 8 Python modules, the README, and the project
proposal, with the pipeline executed end-to-end on both metals and each blocking
defect reproduced in isolation. All figures quoted are outputs of the project's own
code on the bundled synthetic dataset — no numbers in this document are estimates
except the completion percentages and effort ranges, which are judgement calls.*
