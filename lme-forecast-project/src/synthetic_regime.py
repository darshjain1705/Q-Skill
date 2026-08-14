"""
Controlled synthetic testbed with a KNOWN correct routing policy.

WHY THIS EXISTS. The original `make_synthetic_data.py` simulates a
regime-switching random walk. Its returns are unforecastable by
construction -- `shock ~ N(drift, vol)` is white noise -- so no model can
have skill on it and no experiment run on it can ever come out positive.
Worse, its inventory series is generated directly *from* the returns, so
an inventory feature is trivially informative in a way it never will be
on real data. It validates that code runs. It cannot validate that a
method works.

This module builds a different kind of synthetic world, designed so that
the right answer is known in advance:

  * Two latent regimes with genuinely different *structure*, not just
    different volatility:
      - LINEAR regime:    r_t = phi * r_{t-1} + noise
                          an AR expert can fit this; a tree struggles to
                          beat it with limited data.
      - THRESHOLD regime: r_t = psi * r_{t-1} * sgn(|r_{t-2}| - tau) + noise
                          a sign-flipping conditional interaction on a
                          SINGLE lagged magnitude crossing a threshold.
                          `tau` is calibrated in a first simulation pass to
                          the median |r| actually realised inside this
                          regime, so the sign is on ~50% of the time and the
                          UNCONDITIONAL autocorrelation is ~0 -- a linear AR
                          model sees white noise and correctly predicts
                          nothing. The single-feature threshold matters: an
                          axis-aligned tree can split on it directly, whereas
                          a condition comparing two features (|r_{t-2}| vs
                          |r_{t-3}|) is a diagonal boundary that trees
                          approximate badly, which would have made the
                          regime unlearnable by EVERY expert rather than
                          learnable by one. The two regimes are separated by
                          model class, not by signal strength.

  * A fundamental signal (inventory pressure) that LEADS regime change by
    `signal_lead` days, observed with noise. This is the key property: the
    signal carries information about *which model should be trusted next*,
    which is a different claim from carrying information about the next
    return.

  * Ground-truth regime labels exported alongside the data, so
    `OracleRouter` can compute the achievable upper bound on routing gain.

This turns an untestable pipeline into a testable one. If a gate cannot
beat a static combiner HERE -- where a leading signal for regime change
exists by construction and the experts genuinely specialize -- then the
gate is broken, and no amount of real data will rescue it. That makes
this a prerequisite experiment, not a substitute for real data.
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

LINEAR, THRESHOLD = 0, 1


def simulate_regime_switching_metal(
    n_days: int = 2500,
    start_price: float = 2900.0,
    seed: int = 1,
    name: str = "zinc",
    phi: float = 0.50,          # AR coefficient inside the linear regime
    psi: float = 0.75,          # interaction strength inside the threshold regime
    base_vol: float = 0.012,
    signal_lead: int = 5,       # how many days the fundamental signal leads the switch
    signal_noise: float = 0.5,  # how noisy the observed signal is
    switch_prob: float = 0.02,
    tau: float = None,          # threshold; calibrated automatically if None
) -> pd.DataFrame:
    """Simulate one metal with structural regime switching led by a
    fundamental (inventory) signal.

    Returns a frame with the pipeline's usual schema plus two extra
    columns used only for evaluation and never as model input:
    `{name}_regime` (ground truth) and `{name}_regime_next` (the regime in
    force at t+1, i.e. what an ideal router would need to know).
    """
    rng = np.random.default_rng(seed)

    # ---- latent regime path -------------------------------------------
    regime = np.zeros(n_days, dtype=int)
    for t in range(1, n_days):
        regime[t] = 1 - regime[t - 1] if rng.random() < switch_prob else regime[t - 1]

    # ---- fundamental signal that LEADS the regime ----------------------
    # The latent driver is the regime `signal_lead` days AHEAD, so the
    # observable signal genuinely anticipates the structural change rather
    # than reporting it after the fact.
    lead_target = np.concatenate([regime[signal_lead:], np.repeat(regime[-1], signal_lead)])
    driver = pd.Series(lead_target.astype(float)).rolling(signal_lead, min_periods=1).mean().values
    latent_pressure = driver * 2.0 - 1.0                       # roughly [-1, 1]
    observed_pressure = latent_pressure + rng.normal(0, signal_noise, n_days)

    # ---- returns with regime-dependent STRUCTURE -----------------------
    # Two-pass threshold calibration: simulate once with a provisional tau,
    # then set tau to the median |r| actually realised inside the threshold
    # regime so the sign flips ~50/50 and no unconditional AR(1) leaks in.
    def _simulate(tau_value, noise_seed):
        gen = np.random.default_rng(noise_seed)
        rr = np.zeros(n_days)
        rr[:3] = gen.normal(0, base_vol, 3)
        for t in range(3, n_days):
            eps = gen.normal(0, base_vol)
            if regime[t] == LINEAR:
                rr[t] = phi * rr[t - 1] + eps
            else:
                sign = 1.0 if abs(rr[t - 2]) > tau_value else -1.0
                rr[t] = psi * rr[t - 1] * sign + eps
        return rr

    noise_seed = int(rng.integers(0, 2**31 - 1))
    if tau is None:
        provisional = _simulate(base_vol, noise_seed)
        in_thresh = np.abs(provisional[regime == THRESHOLD])
        tau = float(np.median(in_thresh)) if len(in_thresh) > 50 else base_vol
    r = _simulate(tau, noise_seed)

    price = start_price * np.exp(np.cumsum(r))

    # ---- inventory series carrying the pressure signal ------------------
    # Built from the LATENT regime driver plus its own dynamics -- crucially
    # NOT from the returns, so the feature is not a disguised copy of the
    # target the way the original generator's was.
    inv = np.zeros(n_days)
    inv[0] = 150_000.0
    for t in range(1, n_days):
        mean_revert = (150_000.0 - inv[t - 1]) * 0.02
        inv[t] = max(1000.0, inv[t - 1] + mean_revert
                     - observed_pressure[t] * 8_000.0
                     + rng.normal(0, 1_500.0))

    volume = rng.integers(5_000, 20_000, size=n_days)
    dates = pd.bdate_range("2015-01-01", periods=n_days)

    regime_next = np.concatenate([regime[1:], regime[-1:]])

    return pd.DataFrame({
        "date": dates,
        f"{name}_close": price,
        f"{name}_volume": volume,
        f"{name}_inventory": inv,
        f"{name}_regime": regime,            # evaluation only
        f"{name}_regime_next": regime_next,  # evaluation only
    })


def main(outdir: str = "../data", n_days: int = 2500, seed: int = 1):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    zinc = simulate_regime_switching_metal(n_days=n_days, start_price=2900,
                                           seed=seed, name="zinc")
    alu = simulate_regime_switching_metal(n_days=n_days, start_price=2400,
                                          seed=seed + 1, name="aluminium",
                                          phi=0.42, psi=0.68)

    df = zinc.merge(alu, on="date", how="inner")

    rng = np.random.default_rng(42)
    df["usd_index"] = 100 + np.cumsum(rng.normal(0, 0.1, len(df)))
    df["oil_price"] = 70 + np.cumsum(rng.normal(0, 0.3, len(df)))

    out = outdir / "synthetic_regime_daily.csv"
    df.to_csv(out, index=False)

    for metal in ("zinc", "aluminium"):
        reg = df[f"{metal}_regime"]
        ret = np.log(df[f"{metal}_close"]).diff()
        print(f"{metal}: {len(df)} rows | "
              f"linear-regime share {(reg == LINEAR).mean():.2%} | "
              f"switches {int((reg.diff() != 0).sum() - 1)} | "
              f"AR(1) of returns: linear={ret[reg == LINEAR].autocorr(1):+.3f} "
              f"threshold={ret[reg == THRESHOLD].autocorr(1):+.3f}")
    print(f"Saved {out}")
    return df


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", default="../data")
    p.add_argument("--n-days", type=int, default=2500)
    p.add_argument("--seed", type=int, default=1)
    a = p.parse_args()
    main(a.outdir, a.n_days, a.seed)
