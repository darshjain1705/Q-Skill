"""
The project's central experiment: routing versus representation.

THE QUESTION. Given a fundamental signal about physical supply tightness,
is it better used as an INPUT FEATURE to the forecasting models, or as a
META-FEATURE that decides which model to trust? These are different
claims and they have never been separated for commodity forecasting.
Existing meta-learned combination methods route on *endogenous* descriptors
of the series itself -- entropy, trend strength, recent expert errors.
Routing on an *exogenous economic* signal is the part that is new here.

The original project could not ask this question. It compared "gate with
inventory" against "gate without inventory" while the experts never saw
the signal under either condition, so a null result was uninterpretable:
it could have meant the signal is uninformative, or that routing is the
wrong place to put it. The 2x2 below separates those.

               gate WITHOUT inv     gate WITH inv
    experts
    WITHOUT inv     (a) neither         (c) routing only
    WITH inv        (b) representation  (d) both

CONTROLS. Three of them, all absent from the original design and all
load-bearing:

  * Random walk -- the real benchmark for a return forecast. Everything is
    reported relative to it.
  * Static NNLS combiner -- one fixed weight vector. If the gate cannot
    beat this, "dynamic" bought nothing, and the architectural claim fails
    regardless of how the gate compares to single experts.
  * Oracle router -- routes on ground-truth regime labels. Not a
    competitor; an upper bound. Without it, "the gate did not help" cannot
    be distinguished from "there was nothing for it to exploit", and that
    distinction is the difference between a publishable negative result
    and an inconclusive one.

Every combiner is trained on OUT-OF-FOLD expert predictions (see oof.py).
Every comparison carries a Diebold-Mariano test.
"""
import argparse
import warnings

import numpy as np
import pandas as pd

from expert_panel import default_panel, fit_panel, panel_names, panel_predict
from featureset import CONDITIONS, build_return_features
from gating import (ClusteredRouter, GatingNetwork, OracleRouter,
                    StaticCombiner)
from metrics import (diebold_mariano, directional_accuracy, mae, mase,
                     rel_mae, rmse, routing_agreement, weight_dispersion)
from oof import blocked_oof_predictions, trailing_error_features

warnings.filterwarnings("ignore")


# ---------------------------------------------------------------------
# Gate state assembly
# ---------------------------------------------------------------------

def _generic_gate_names(cols, metal):
    """Strip the metal prefix so a gate fitted on one metal can be applied
    to another. Used only by the transfer experiment."""
    return [c.replace(f"gate_{metal}_", "gate_") for c in cols]


def _build_gate_state(df, spec, rows, trail, metal_agnostic=False):
    """Gate input = market-state columns + trailing expert errors.

    The trailing-error block is the piece the proposal specified and the
    original implementation silently dropped: `build_gate_state_vector`
    accepted `expert_error_cols` but `build_feature_set` never passed it.
    """
    base = df.iloc[rows][spec.gate_cols].copy()
    if metal_agnostic:
        base.columns = _generic_gate_names(list(base.columns), spec.metal)
    err = pd.DataFrame(
        trail[rows],
        columns=[f"gate_trailerr_{i}" for i in range(trail.shape[1])],
        index=base.index,
    )
    return pd.concat([base, err], axis=1)


# ---------------------------------------------------------------------
# One fold
# ---------------------------------------------------------------------

def run_fold(df, spec, panel, test_start, test_end, oof_blocks=5,
             gate_temperature=0.5, collect_gate=False,
             oracle_modes=("forward", "trailing")):
    """Fit everything on rows [0, test_start) and score [test_start, test_end)."""
    train_df = df.iloc[:test_start].reset_index(drop=True)
    test_idx = np.arange(test_start, test_end)
    y_train = train_df[spec.target_col].values
    y_test = df[spec.target_col].values[test_idx]

    # --- honest expert predictions across the training window -----------
    oof, valid = blocked_oof_predictions(panel, train_df, spec, n_blocks=oof_blocks)
    if valid.sum() < 60:
        return None

    # --- experts refit on the whole training window, scored on test -----
    fitted = fit_panel(panel, train_df, spec)
    test_preds = panel_predict(fitted, df.iloc[:test_end], test_idx, spec)

    # --- causal trailing-error features spanning train + test ------------
    all_err = np.full((test_end, len(panel)), np.nan)
    all_err[:test_start] = np.abs(oof - y_train[:, None])
    all_err[test_start:test_end] = np.abs(test_preds - y_test[:, None])
    trail = trailing_error_features(all_err, window=10, lag=1)

    train_rows = np.where(valid)[0]
    gate_train_X = _build_gate_state(df, spec, train_rows, trail)
    gate_test_X = _build_gate_state(df, spec, test_idx, trail)

    oof_v, y_v = oof[valid], y_train[valid]

    # --- combiners -------------------------------------------------------
    static = StaticCombiner().fit(oof_v, y_v)
    static_pred, _ = static.combine(test_preds)

    out = {
        "y_true": y_test,
        "rw": np.zeros_like(y_test),
        "simple_avg": test_preds.mean(axis=1),
        "static_nnls": static_pred,
        "expert_preds": test_preds,
        "y_train": y_train,
        "static_weights": static.weights_,
    }

    gate = None
    for mode in oracle_modes:
        g = GatingNetwork(temperature=gate_temperature, oracle_mode=mode).fit(
            gate_train_X, oof_v, y_v)
        pred, w = g.combine(gate_test_X, test_preds)
        key = "gated" if mode == "forward" else f"gated_{mode}"
        out[key] = pred
        out["gate_weights" if mode == "forward" else f"gate_weights_{mode}"] = w
        if mode == "forward":
            gate = g
    if "gate_weights" not in out:                     # forward mode not requested
        first = oracle_modes[0]
        out["gate_weights"] = out[f"gate_weights_{first}"]
        out["gated"] = out[f"gated_{first}"]
    for i, nm in enumerate(panel_names(panel)):
        out[f"expert_{nm}"] = test_preds[:, i]

    # --- oracle routing upper bound --------------------------------------
    if spec.regime_col is not None:
        reg_train = df[spec.regime_col].values[:test_start][valid]
        reg_test = df[spec.regime_col].values[test_idx]
        router = OracleRouter().fit(reg_train, oof_v, y_v)
        out["oracle_router"], out["oracle_weights"] = router.combine(reg_test, test_preds)

    if collect_gate:
        out["gate_train_X"] = gate_train_X
        out["gate_obj"] = gate
        out["fitted_experts"] = fitted
    return out


def walk_forward(df, spec, panel, n_folds=5, min_train_frac=0.5, **kw):
    n = len(df)
    warm = int(n * min_train_frac)
    fold = (n - warm) // n_folds
    if fold < 40:
        raise ValueError(f"fold size {fold} too small; reduce n_folds or min_train_frac")

    folds = []
    for k in range(n_folds):
        s = warm + k * fold
        e = n if k == n_folds - 1 else s + fold
        r = run_fold(df, spec, panel, s, e, **kw)
        if r is not None:
            r["fold"] = k
            folds.append(r)
    return folds


# ---------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------

def summarize(folds, model_names, panel):
    """Pool predictions across folds, then score. Pooling before scoring
    (rather than averaging per-fold metrics) is the standard choice when
    fold sizes differ."""
    y = np.concatenate([f["y_true"] for f in folds])
    y_train_all = folds[0]["y_train"]
    rw = np.concatenate([f["rw"] for f in folds])

    rows = {}
    for m in model_names:
        if m not in folds[0]:
            continue
        p = np.concatenate([f[m] for f in folds])
        d = directional_accuracy(y, p)
        dm_rw = diebold_mariano(y, p, rw, label_a=m, label_b="rw")
        rows[m] = {
            "MAE": mae(y, p),
            "RMSE": rmse(y, p),
            "RelMAE_vs_RW": rel_mae(y, p, rw),
            "MASE": mase(y, p, y_train_all),
            "DirAcc": d.accuracy,
            "DecRate": d.decision_rate,
            "p_vs_RW": dm_rw.p_value,
        }

    if "static_nnls" in folds[0]:
        stat = np.concatenate([f["static_nnls"] for f in folds])
        for m in rows:
            p = np.concatenate([f[m] for f in folds])
            rows[m]["p_vs_static"] = diebold_mariano(y, p, stat).p_value

    return pd.DataFrame(rows).T.sort_values("MAE")


def gate_diagnostics(folds, panel):
    """Does the gate actually route, independently of whether it wins?"""
    w = np.concatenate([f["gate_weights"] for f in folds])
    y = np.concatenate([f["y_true"] for f in folds])
    ep = np.concatenate([f["expert_preds"] for f in folds])
    err = ep - y[:, None]

    d = weight_dispersion(w)
    return {
        "routing_agreement": routing_agreement(w, err),
        "chance_agreement": 1.0 / len(panel),
        "mean_weights": dict(zip(panel_names(panel), np.round(d["mean"], 3))),
        "weight_std_over_time": dict(zip(panel_names(panel), np.round(d["std_over_time"], 3))),
        "mean_entropy": round(d["mean_entropy"], 3),
        "mean_effective_experts": round(d["mean_effective_experts"], 2),
    }


# ---------------------------------------------------------------------
# The 2x2
# ---------------------------------------------------------------------

def run_2x2(raw, metal, n_folds=5, min_train_frac=0.5, gate_temperature=0.5,
            verbose=True):
    panel = default_panel()
    names = panel_names(panel)
    model_names = (["rw"] + [f"expert_{n}" for n in names]
                   + ["simple_avg", "static_nnls", "gated_trailing", "gated",
                      "oracle_router"])

    results, diagnostics, pooled = {}, {}, {}
    for cond, cfg in CONDITIONS.items():
        df, spec = build_return_features(raw, metal, **cfg)
        folds = walk_forward(df, spec, panel, n_folds=n_folds,
                             min_train_frac=min_train_frac,
                             gate_temperature=gate_temperature)
        results[cond] = summarize(folds, model_names, panel)
        diagnostics[cond] = gate_diagnostics(folds, panel)
        pooled[cond] = folds
        if verbose:
            print(f"\n### condition = {cond}   ({spec.describe()})")
            print(results[cond].round(5).to_string())
            print(f"  routing agreement {diagnostics[cond]['routing_agreement']:.3f} "
                  f"(chance {diagnostics[cond]['chance_agreement']:.3f})  |  "
                  f"effective experts {diagnostics[cond]['mean_effective_experts']} of {len(panel)}")
    return results, diagnostics, pooled


def routing_vs_representation_table(results):
    """The paper's headline table: what does moving the signal do?"""
    rows = {}
    for cond in ("neither", "representation", "routing", "both"):
        if cond not in results:
            continue
        r = results[cond]
        rows[cond] = {
            "gated_fwd_MAE": r.loc["gated", "MAE"] if "gated" in r.index else np.nan,
            "gated_trail_MAE": r.loc["gated_trailing", "MAE"] if "gated_trailing" in r.index else np.nan,
            "gated_RelMAE": r.loc["gated", "RelMAE_vs_RW"] if "gated" in r.index else np.nan,
            "gated_MAE": r.loc["gated", "MAE"] if "gated" in r.index else np.nan,
            "static_MAE": r.loc["static_nnls", "MAE"] if "static_nnls" in r.index else np.nan,
            "best_expert_MAE": min(r.loc[i, "MAE"] for i in r.index if i.startswith("expert_")),
            "oracle_MAE": r.loc["oracle_router", "MAE"] if "oracle_router" in r.index else np.nan,
            "gate_p_vs_static": r.loc["gated", "p_vs_static"] if "gated" in r.index else np.nan,
        }
    t = pd.DataFrame(rows).T
    if "neither" in t.index:
        t["gain_vs_neither_%"] = (t.loc["neither", "gated_MAE"] - t["gated_MAE"]) / t.loc["neither", "gated_MAE"] * 100
    return t


# ---------------------------------------------------------------------
# Where does the routing gain go?
# ---------------------------------------------------------------------

def routing_gain_decomposition(df, spec, panel, test_start, test_end,
                               gate_temperature=0.5):
    """Split the oracle-to-learned routing gap into its two costs.

    A learned router can fail for two separable reasons: it identifies the
    regime badly, or it estimates the regime-conditional weights badly.
    Reporting only "the gate lost to the static combiner" cannot tell them
    apart, and the two have completely different remedies.

    Four rungs, each adding one source of error:

        static                       no routing at all
        oracle regime + oracle wts   the full achievable gain
        predicted regime + oracle wts    <- adds ONLY classification error
        learned gate / clustered router  adds weight-estimation error too

    The drop from rung 2 to rung 3 is the price of not knowing the regime,
    holding the weights perfect. In this project's testbed that single
    step consumes most of the available gain, which localises the problem
    precisely: conditional combination needs regime identification far
    more accurate than a strong classifier actually delivers.
    """
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import accuracy_score

    if spec.regime_col is None:
        return None

    train_df = df.iloc[:test_start].reset_index(drop=True)
    test_idx = np.arange(test_start, test_end)
    y_train = train_df[spec.target_col].values
    y_test = df[spec.target_col].values[test_idx]

    oof, valid = blocked_oof_predictions(panel, train_df, spec)
    if valid.sum() < 60:
        return None
    fitted = fit_panel(panel, train_df, spec)
    test_preds = panel_predict(fitted, df.iloc[:test_end], test_idx, spec)

    all_err = np.full((test_end, len(panel)), np.nan)
    all_err[:test_start] = np.abs(oof - y_train[:, None])
    all_err[test_start:test_end] = np.abs(test_preds - y_test[:, None])
    trail = trailing_error_features(all_err, window=10, lag=1)

    X_tr = _build_gate_state(df, spec, np.where(valid)[0], trail)
    X_te = _build_gate_state(df, spec, test_idx, trail)
    oof_v, y_v = oof[valid], y_train[valid]

    reg_tr = df[spec.regime_col].values[:test_start][valid]
    reg_te = df[spec.regime_col].values[test_idx]

    static = StaticCombiner().fit(oof_v, y_v)
    p_static, _ = static.combine(test_preds)

    router = OracleRouter().fit(reg_tr, oof_v, y_v)
    p_oracle, _ = router.combine(reg_te, test_preds)

    clf = HistGradientBoostingClassifier(max_iter=200, random_state=0)
    clf.fit(X_tr.values, reg_tr)
    proba = clf.predict_proba(X_te.values)
    hard = clf.classes_[np.argmax(proba, axis=1)]
    p_pred_hard, _ = router.combine(hard, test_preds)

    W = np.vstack([router.regime_weights_.get(c, router.fallback_)
                   for c in clf.classes_])
    p_pred_soft = np.sum((proba @ W) * test_preds, axis=1)

    gate = GatingNetwork(temperature=gate_temperature).fit(X_tr, oof_v, y_v)
    p_gate, _ = gate.combine(X_te, test_preds)
    clustered = ClusteredRouter(n_regimes=3).fit(X_tr, oof_v, y_v)
    p_clust, _ = clustered.combine(X_te, test_preds)

    base = mae(y_test, p_static)
    rungs = [
        ("static (no routing)", p_static),
        ("oracle regime + oracle wts", p_oracle),
        ("predicted regime (hard) + oracle wts", p_pred_hard),
        ("predicted regime (soft) + oracle wts", p_pred_soft),
        ("learned gate (error imitation)", p_gate),
        ("clustered router (k=3)", p_clust),
    ]
    rows = {}
    for nm, p in rungs:
        rows[nm] = {
            "MAE": mae(y_test, p),
            "vs_static_%": (mae(y_test, p) / base - 1) * 100,
            "p_vs_static": diebold_mariano(y_test, p, p_static).p_value,
        }
    table = pd.DataFrame(rows).T

    oracle_gain = base - mae(y_test, p_oracle)
    retained = (base - mae(y_test, p_pred_soft)) / oracle_gain if oracle_gain > 0 else np.nan
    meta = {
        "regime_classifier_accuracy": float(accuracy_score(reg_te, hard)),
        "oracle_gain_%": float(oracle_gain / base * 100),
        "fraction_of_gain_retained_by_best_learned": float(retained),
    }
    return table, meta


# ---------------------------------------------------------------------
# Cross-metal transfer
# ---------------------------------------------------------------------

def cross_metal_transfer(raw, source_metal, target_metal, condition="both",
                         n_folds=5, min_train_frac=0.5, gate_temperature=0.5):
    """Fit the ROUTING POLICY on one metal, apply it to another.

    Motivated directly by the project's hardest constraint: free daily
    price and warehouse-stock data exists for some base metals and not
    others. If the combination policy transfers even when the experts do
    not, a data-rich metal can supply the router for a data-poor one --
    which is a practically useful claim and a testable one.

    The experts are always refit on the target metal. Only the gate is
    transferred, which is what isolates the policy from the forecasts.
    """
    panel = default_panel()
    cfg = CONDITIONS[condition]

    src_df, src_spec = build_return_features(raw, source_metal, **cfg)
    tgt_df, tgt_spec = build_return_features(raw, target_metal, **cfg)

    n = min(len(src_df), len(tgt_df))
    src_df, tgt_df = src_df.iloc[:n].copy(), tgt_df.iloc[:n].copy()

    warm = int(n * min_train_frac)
    fold = (n - warm) // n_folds

    out = []
    for k in range(n_folds):
        s = warm + k * fold
        e = n if k == n_folds - 1 else s + fold

        # --- source: fit the gate only ---------------------------------
        src = run_fold(src_df, src_spec, panel, s, e,
                       gate_temperature=gate_temperature, collect_gate=True)
        # --- target: everything native except the gate ------------------
        tgt = run_fold(tgt_df, tgt_spec, panel, s, e,
                       gate_temperature=gate_temperature, collect_gate=True)
        if src is None or tgt is None:
            continue

        src_X = src["gate_train_X"].copy()
        tgt_test_X = tgt["gate_train_X"]  # placeholder to grab column layout
        # Re-derive the target's test-time gate state with generic names.
        test_idx = np.arange(s, e)
        y_test = tgt_df[tgt_spec.target_col].values[test_idx]

        # Rename both sides to metal-agnostic columns so the fitted gate applies.
        src_X.columns = _generic_gate_names(list(src_X.columns), source_metal)
        transfer_gate = GatingNetwork(temperature=gate_temperature)

        # refit the source gate on generic column names
        src_oof, src_valid = blocked_oof_predictions(panel, src_df.iloc[:s], src_spec)
        if src_valid.sum() < 60:
            continue
        transfer_gate.fit(src_X, src_oof[src_valid],
                          src_df[src_spec.target_col].values[:s][src_valid])

        tgt_gate_X = tgt_test_X.iloc[:0]  # not used further; kept for clarity
        del tgt_gate_X

        # Build the target's TEST gate state with generic names.
        tgt_folds_X = _build_gate_state_for_transfer(tgt, tgt_df, tgt_spec, test_idx, target_metal)
        pred, w = transfer_gate.combine(tgt_folds_X, tgt["expert_preds"])

        out.append({
            "y_true": y_test,
            "rw": np.zeros_like(y_test),
            "native_gated": tgt["gated"],
            "transferred_gated": pred,
            "static_nnls": tgt["static_nnls"],
            "gate_weights": w,
            "expert_preds": tgt["expert_preds"],
            "y_train": tgt["y_train"],
            "fold": k,
        })
    return out, panel


def _build_gate_state_for_transfer(fold_result, df, spec, rows, metal):
    """Recompute the target metal's gate state with metal-agnostic column
    names so a gate fitted on another metal can consume it."""
    base = df.iloc[rows][spec.gate_cols].copy()
    base.columns = _generic_gate_names(list(base.columns), metal)
    n_exp = fold_result["expert_preds"].shape[1]
    err = np.abs(fold_result["expert_preds"] - fold_result["y_true"][:, None])
    trail = trailing_error_features(err, window=10, lag=1)
    err_df = pd.DataFrame(trail, columns=[f"gate_trailerr_{i}" for i in range(n_exp)],
                          index=base.index)
    return pd.concat([base, err_df], axis=1)


# ---------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="../data/synthetic_regime_daily.csv")
    p.add_argument("--metal", default="zinc")
    p.add_argument("--folds", type=int, default=5)
    p.add_argument("--min-train-frac", type=float, default=0.5)
    p.add_argument("--temperature", type=float, default=0.5)
    p.add_argument("--transfer", action="store_true")
    a = p.parse_args()

    raw = pd.read_csv(a.data, parse_dates=["date"])
    print(f"Dataset: {a.data}  ({len(raw)} rows)   metal: {a.metal}")
    print("Target: next-day log return.  Benchmark: random walk.\n")

    results, diags, _ = run_2x2(raw, a.metal, n_folds=a.folds,
                                min_train_frac=a.min_train_frac,
                                gate_temperature=a.temperature)

    print("\n" + "=" * 78)
    print("ROUTING vs REPRESENTATION -- where should the fundamental signal go?")
    print("=" * 78)
    print(routing_vs_representation_table(results).round(5).to_string())

    if a.transfer:
        other = "aluminium" if a.metal == "zinc" else "zinc"
        print("\n" + "=" * 78)
        print(f"CROSS-METAL TRANSFER: gate fitted on {other}, applied to {a.metal}")
        print("=" * 78)
        folds, panel = cross_metal_transfer(raw, other, a.metal, n_folds=a.folds,
                                            min_train_frac=a.min_train_frac,
                                            gate_temperature=a.temperature)
        if folds:
            print(summarize(folds, ["rw", "static_nnls", "native_gated",
                                    "transferred_gated"], panel).round(5).to_string())


if __name__ == "__main__":
    main()
