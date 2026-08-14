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

Full walk-forward run, both metals, all four conditions. `results/00_run_log.txt` has
the complete transcript.

### 4.1 The routing gain is real

An oracle router — one that knows the true regime — beats static combination
significantly on both metals, in every condition:

| Metal | Oracle vs static | p |
|---|---:|---:|
| zinc | −1.6% to −2.0% | 0.006–0.019 |
| aluminium | −3.5% | 0.0003–0.001 |

So conditional combination has something to capture. The question is who can capture it.

### 4.2 The inventory signal belongs in the router

This is the finding, and it is 4/4 consistent. Below: predicted-regime routing with
oracle-optimal regime weights, measured against static combination. Negative is better.

| Metal | Experts | Gate **without** inventory | Gate **with** inventory |
|---|---|---:|---:|
| zinc | without | **+1.91%** (p=0.001, significantly *worse*) | −0.26% (ns) |
| zinc | with | **+1.00%** (p=0.035, significantly *worse*) | −0.17% (ns) |
| aluminium | without | **+1.73%** (p=0.067) | −1.21% (ns) |
| aluminium | with | +0.12% (ns) | −1.40% (ns) |

Giving the gate the inventory signal flips routing from actively harmful to mildly
beneficial, in all four metal × expert-condition pairs. The mechanism is transparent
— it is regime identification:

| Metal | Regime-classifier accuracy, gate without inv | with inv |
|---|---:|---:|
| zinc | 0.462 | **0.675** |
| aluminium | 0.574 | **0.805** |

The signal predicts the next regime at AUC 0.85–0.90 on its own. Without it, the
gate's remaining inputs (volatility, Hurst, trailing expert errors) identify the regime
barely above chance, and routing on a coin flip is worse than not routing at all.

**This supports the project's original intuition** — the inventory signal does belong
in the gate — while explaining why the original implementation could never have shown
it. That design put the signal only in the gate, never in the experts, so it had no
way to establish that the *placement* was what mattered rather than the signal itself.

### 4.3 But most of the gain is still lost

Even with the signal in the router, only part of the oracle gain survives, and none of
it reaches significance:

```
                          classifier acc    oracle gain    retained
zinc      (gate w/ inv)       0.675           2.04%          13%
aluminium (gate w/ inv)       0.805           3.48%          35%
zinc      (gate w/o inv)      0.462           2.04%         -94%
aluminium (gate w/o inv)      0.574           3.48%         -50%
```

The dose-response across all four rows is what makes this an explanation rather than
an anecdote: retained gain tracks regime-identification accuracy monotonically, and
turns negative once accuracy falls below roughly 0.6. Conditional combination needs
regime identification far more accurate than even a good signal delivers.

And the learned gate — the original architecture, repaired — captures none of it under
any condition, losing to static combination by 4–10% (all p<0.001). Error imitation is
the wrong objective: it predicts *which expert was recently accurate*, when what is
needed is *which regime comes next*.

**One honest note.** I expected trailing-error supervision to be the whole problem, and
that switching to forward supervision would close the gap. It did not — pointwise
forward targets are a single-sample estimate of "who wins here" and the gate fits the
noise. Both supervision schemes fail, for opposite reasons.

## 5. What this is worth as a paper

More than the original framing, for a specific reason: the claim no longer depends on
beating a benchmark. It depends on a decomposition, and decompositions survive
negative results.

- **The contribution is a finding, not a component.** Two claims, both checkable:
  a fundamental signal's value in forecast combination lies in *routing* rather than
  *representation* (4/4 consistent, with the regime-identification mechanism shown);
  and conditional combination is bottlenecked by identification accuracy, with a
  threshold near 0.6 below which routing is worse than not routing.
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
