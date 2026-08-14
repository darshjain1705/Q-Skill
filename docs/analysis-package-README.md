# LME Forecast Project — Analysis, Reframing, and Results

Everything produced in this analysis, in one package.

Two questions were asked: **how much work is done, and is it publishable?** The answer
to the second was *not as framed* — so the project was reframed around a question that
can be defended, and that reframing was implemented and run.

---

## Start here

| Read this | For |
|---|---|
| `reports/01-project-audit.html` | The original codebase: what was built, what was left, three blocking defects, and why the work was not publishable as framed |
| `reports/02-routing-vs-representation.html` | The reframing: the new question, the controlled testbed, the experiment, and the result |

Both are self-contained web pages — open in any browser, no network needed. Markdown
equivalents are in `docs/`.

---

## Package contents

```
.
├── README.md                              this file
├── reports/
│   ├── 01-project-audit.html              audit of the original code
│   ├── 02-routing-vs-representation.html  the reframing and its results
│   └── code-changes.patch                 full diff: original -> current
├── docs/
│   ├── lme-forecast-project-audit.md      audit, markdown
│   └── routing-vs-representation.md       reframing, markdown
└── lme-forecast-project/
    ├── README.md                          project readme
    ├── requirements.txt
    ├── src/                               all code (new + original, both kept)
    ├── data/                              generated datasets
    ├── results/                           every documented number, regenerated
    ├── app/app.py                         Streamlit demo
    └── paper/                             original proposal
```

---

## The two findings in one paragraph each

**Audit.** The project was ~40% complete against its 15-week plan — the software
roughly 70% built, the research roughly 15%, since no defensible result existed. When
run, the pipeline reported that the gated Mixture-of-Experts *lost to a naive
persistence baseline by 4.6×* and that removing the inventory signal slightly improved
accuracy. Three defects explained most of it, the worst being that a second `softmax`
applied to an already-normalized weight vector made the gate mathematically incapable
of adapting: observed weights `[0.564, 0.219, 0.217]` against the collapse target
`softmax([1,0,0]) = [0.576, 0.212, 0.212]`.

**Reframing.** The novelty could not be another component — learned gating supervised
on trailing errors is an established family. So the question changed to *should a
fundamental signal inform the forecast, or the choice of forecaster?* — a 2×2 the
original design could not express. On a controlled testbed with a known-correct
routing policy: regime-conditional combination genuinely beats static combination
(1.6–2.0% zinc, 3.5% aluminium, all significant); **the inventory signal belongs in
the router, not the experts** — putting it in the gate lifts regime-identification
accuracy from 0.46→0.68 (zinc) and 0.57→0.81 (aluminium) and flips routing from
significantly harmful to mildly beneficial, 4/4 consistent across metals and expert
conditions; but even so only 13–35% of the oracle gain survives, and the original
error-imitation gate captures none of it.

---

## Reproducing the numbers

```bash
cd lme-forecast-project
pip install -r requirements.txt
cd src
python reproduce.py          # ~20 min, writes to ../results/
```

`results/00_run_log.txt` is the full transcript; each section header names the claim in
`docs/routing-vs-representation.md` it supports. The CSVs alongside it are the same
tables machine-readable.

To run one piece:

```bash
python synthetic_regime.py               # rebuild the testbed
python experiment.py --metal aluminium   # the 2x2 for one metal
python gating.py                         # gate self-test
```

---

## Important caveat

**Every result is from a synthetic testbed.** It was built specifically because the
original synthetic data could not validate any method — its returns were white noise
and its inventory series was generated *from* the returns. The new testbed establishes
that the machinery works and that the failure mode is real. It is a prerequisite for
the real-data experiment, **not a substitute for it**.

Real LME warehouse stocks and daily zinc prices remain unsourced and are still the
critical path. The difference is that the experiment is now designed so the real-data
run produces an interpretable answer whichever way it comes out.

---

## Publication assessment, short version

Not publishable as originally framed: no real data, the result contradicted the
thesis, the novel component showed no effect, and the novelty claim was asserted with
zero citations compiled.

Publishable as reframed, if the real-data run holds up — because the claim no longer
depends on beating a benchmark. It depends on a decomposition, and decompositions
survive negative results. Realistic venues are applied-AI-in-finance conferences and
forecasting symposia; top-tier ML main tracks are not realistic at this scope.

The single highest-value next step is cheap: sweep the testbed's `signal_noise` to
trace the full regime-identification-accuracy vs. retained-gain curve, and find the
classifier accuracy at which conditional combination starts paying. That threshold
would be the paper's most quotable result and is a day or two of compute.
