# Routing vs Representation — a defensible reframing of the LME project

The original claim cannot be defended. The codebase is one reframing away from a
question that can be. This document records the new question, the experiment that
answers it, and the result.

All figures are outputs of code on branch `claude/work-analysis-conference-paper-kcx0a4`,
reproducible via:

```bash
cd lme-forecast-project/src
python synthetic_regime.py
python experiment.py --metal aluminium
```

---

## 1. Why the novelty could not be another component

"Learned gating over a pool of forecasters, supervised on their trailing errors" is
an established family. Bolting an inventory feature onto its input is a
feature-engineering delta inside someone else's architecture — the thing a reviewer
desk-rejects.

So the question changed instead. The original asks *does the inventory signal improve
the gated ensemble* — and the audit showed the code could not answer it, because the
experts never saw the signal under any condition. A null result was uninterpretable:
it could mean the signal is uninformative, or that gating is the wrong place for it.

**New question: should a fundamental signal inform the forecast, or the choice of
forecaster?**

Existing meta-learned combination methods route on *endogenous* descriptors — series
entropy, trend strength, recent expert errors. Routing on an *exogenous economic*
signal is a different proposition, and separating "signal as model input" from
"signal as routing input" is a question the commodity-forecasting literature has not
asked.

|                       | Gate without inventory | Gate with inventory |
|-----------------------|------------------------|---------------------|
| **Experts without**   | (a) neither            | (c) routing only    |
| **Experts with**      | (b) representation     | (d) both            |

All four conditions share one feature frame, one set of folds, and one dropna, so
they are exactly comparable — they differ only in which columns each component reads.

---

## 2. The testbed the project was missing

The bundled generator simulates a regime-switching random walk. Its returns are
`N(drift, vol)` white noise — unforecastable by construction — so no model can have
skill on it. Its inventory series is generated *from* the returns, making the
inventory feature a disguised copy of the target. It validates that code runs; it
cannot validate that a method works.

`synthetic_regime.py` builds a world where the right answer is known in advance. Two
regimes differing by **model class**, not signal strength:

- **Linear regime** — `r_t = φ·r_{t−1} + ε`. An AR model fits this; a tree struggles.
- **Threshold regime** — `r_t = ψ·r_{t−1}·sgn(|r_{t−2}| − τ) + ε`. With τ calibrated
  to the median |r| realised inside the regime, unconditional autocorrelation is ≈0,
  so a linear model correctly sees white noise while a tree conditioning on the
  lagged magnitude recovers the structure.

A fundamental signal leads regime change by five days, observed with noise.
Ground-truth regime labels are exported for evaluation only, never as model input.

Two calibration details mattered more than expected and belong in the methods section:

1. A threshold comparing *two* features (`|r_{t−2}|` vs `|r_{t−3}|`) is a diagonal
   boundary that axis-aligned trees approximate badly — it made the regime
   unlearnable by *every* expert rather than learnable by one.
2. τ must be calibrated in a first simulation pass against the variance the regime
   actually realises, or the sign stops flipping 50/50 and linear autocorrelation
   leaks back in.

The result is genuine specialization. On aluminium, boosting is *worse than a random
walk* in the linear regime (relative MAE 1.053) and clearly best in the threshold
regime (0.881), while ARIMA runs the other way (0.898 → 0.949).

---

## 3. Four defects fixed before any of this could run

| Defect | Evidence | Fix |
|---|---|---|
| **Double softmax** (blocking) | Gate emitted a constant vector. Observed `[0.564, 0.219, 0.217]` vs collapse target `softmax([1,0,0]) = [0.576, 0.212, 0.212]`. | Regress onto *log* weights, softmax at inference. Self-test MAE 0.395 → 0.239. |
| **In-sample gate supervision** (blocking) | Boosting: 11.85 MAE in-sample, 576.37 out-of-sample. Oracle gave it weight 0.97; gave the actually-best expert 0.02. | Blocked, forward-only out-of-fold expert predictions (`oof.py`). |
| **`early_stopping=True`** (major) | Holds out 10% of a short window, halts on a noisy multi-output score. Degraded the gate to routing accuracy **0.100** — worse than chance. | Off by default; regularize with `alpha`. |
| **Unscaled MLP target** (major) | Log returns are ~1e-2; the MLP converged near the mean. Scored 0.049 against 0.010 for every other expert, dragging the simple average to 1.51× the random walk. | `TransformedTargetRegressor`. A scaling bug — reporting it as "sequence models don't work here" would have been a real error in the paper. |

---

## 4. The result

Aluminium, condition (d), walk-forward. MAE ×10³, lower is better.

| Model | MAE | vs static | p | What it isolates |
|---|---:|---:|---:|---|
| static combination | 10.080 | — | — | No routing at all. The control. |
| **oracle regime + oracle weights** | **9.725** | **−3.52%** | **0.0003** | The full achievable gain. Routing *is* worth something. |
| predicted regime (soft) + oracle weights | 9.939 | −1.40% | 0.118 | Adds *only* classification error. Already not significant. |
| clustered router (k=3) | 10.346 | +2.64% | 0.017 | Adds weight-estimation error. Now losing. |
| learned gate (error imitation) | 10.634 | +5.49% | 0.0004 | The original architecture, repaired. Still losing. |

### The finding

Regime-conditional combination has a real edge over static combination — 1.6% on
zinc, 3.5% on aluminium, both significant. **No learned router captures it.** The
decomposition localises where it goes: swapping ground-truth regimes for predicted
ones, while holding the regime-conditional weights perfect, destroys most of the gain
on its own.

```
                          classifier acc    oracle gain    retained by best learned
zinc                          0.675          1.56%              11%
aluminium                     0.779          3.52%              40%
```

The dose-response across metals is what makes this an explanation rather than an
anecdote: the metal with the more accurate regime classifier retains proportionally
more of the gain. Conditional combination needs regime identification far more
accurate than a strong classifier delivers — and the inventory signal, which predicts
the next regime at **AUC 0.85–0.90**, is not the bottleneck. Identification accuracy is.

This is a mechanistic account of the *forecast combination puzzle* — the long-standing
observation that simple averages are hard to beat with estimated weights — extended
from static weights to conditional ones. That connection gives the result a literature
to land in rather than being a lone negative.

**One honest note.** I expected the opposite. The first hypothesis was that
trailing-error supervision structurally cannot exploit a leading signal, and that
forward supervision would close the gap. It did not — pointwise forward targets are a
single-sample estimate of "who wins here" and the gate fits the noise. Both
supervision schemes fail, for opposite reasons. The finding survived an attempt to get
the desired result, which is the main reason to believe it.

---

## 5. What this is worth as a paper

More than the original framing, for a specific reason: the claim no longer depends on
beating a benchmark. It depends on a decomposition, and decompositions survive
negative results.

- **The contribution is a finding, not a component.** "Conditional forecast combination
  is bottlenecked by regime identification, not signal quality, and here is the oracle
  decomposition that shows it" is checkable and not easily dismissed as incremental.
- **The negative result is load-bearing.** With an oracle upper bound in the design,
  "our router did not help" separates "no gain exists" from "we failed to capture it".
  Without it, the same table is inconclusive.
- **The experimental design is reusable.** The 2×2, the oracle bound, and the gain
  decomposition apply to any conditional-combination claim. That is the part most
  likely to get cited.
- **It is honest about prior art.** The architecture is acknowledged as an established
  family; the novelty claimed is the question and the decomposition.

### Where it can land

- **Realistic** — applied-AI-in-finance venues and forecasting symposia, main track
  rather than poster, if the real-data run holds up. Applied journals in forecasting
  and expert systems take work of this shape.
- **Plausible** — a methods-oriented workshop at a larger ML venue, framed on the
  decomposition rather than the metals.
- **Still not** — top-tier ML main tracks. Scope is too narrow regardless of execution.

### What has not changed

Every number above is from the controlled testbed. That testbed exists to establish
that the machinery works and that the failure mode is real — it is a prerequisite for
the real-data experiment, **not a substitute for it**. Real LME warehouse stocks and
daily zinc prices are still unsourced and remain the critical path. The difference is
that the experiment is now designed so the real-data run produces an interpretable
answer whichever way it comes out.

---

## 6. Next steps

1. **Sweep the identification-accuracy threshold.** The two metals give two points on
   an accuracy-to-retained-gain curve. Sweep the testbed's `signal_noise` to trace the
   whole curve and find the classifier accuracy at which conditional combination starts
   paying. That number is the paper's most quotable result. *(1–2 days; highest value
   per hour on this list.)*
2. **Source the real data.** Unchanged, still the hard blocker. *(1–2 weeks, mostly
   waiting on access.)*
3. **Fit the regime model properly on real data.** The testbed has ground-truth labels;
   real data does not. Fit a Markov-switching model on the training window only. The
   oracle bound becomes estimated rather than exact — say so, and report sensitivity.
   *(3–5 days.)*
4. **Run the cross-metal transfer experiment.** Scaffolded in `experiment.py`, not yet
   validated. If the routing policy transfers from a data-rich metal to a data-poor
   one, the project's worst constraint becomes a contribution. *(2–3 days.)*
5. **Write it around the decomposition.** The architecture is prior art; the
   decomposition is the paper. *(2 weeks.)*

---

## Module map

| Module | Purpose |
|---|---|
| `metrics.py` | MASE, RelMAE vs random walk, Diebold–Mariano with Harvey correction, abstention-aware directional accuracy, gate entropy / effective experts, routing agreement |
| `featureset.py` | Return-target features with the expert/gate column partition varied independently (the 2×2) |
| `expert_panel.py` | Four experts behind one interface; ARIMA wired in for the first time; random-walk member removed from the panel since it was also the benchmark |
| `oof.py` | Blocked, forward-only out-of-fold expert predictions for honest combiner supervision |
| `synthetic_regime.py` | Controlled testbed: regimes differing by model class, a leading fundamental signal, ground-truth labels |
| `experiment.py` | The 2×2, all controls, the routing-gain decomposition, cross-metal transfer scaffold |
| `gating.py` | `StaticCombiner` (control), `GatingNetwork` (repaired), `OracleRouter` (upper bound), `ClusteredRouter` (two-stage) |
