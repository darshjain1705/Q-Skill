"""
Generate everything the visual dashboard needs, from the REAL price data.

    python build_dashboard_data.py

Writes results/dashboard_data.json containing, for each metal:
  * recent price history
  * an honest out-of-sample backtest (actual vs. what the model predicted,
    one step ahead, on data the model never saw)
  * a 10-business-day forward projection with an uncertainty band
  * the model leaderboard

NOTE ON THE FORWARD PROJECTION. The models in this project do not
significantly beat a random walk on real data (see results/08_*). The
projection is therefore shown WITH its uncertainty band, which is wide by
construction -- that width is the honest message, not a defect. It is
included because seeing the band is a better way to understand forecast
difficulty than reading a p-value.
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from expert_panel import default_panel, fit_panel, panel_names, panel_predict  # noqa: E402
from featureset import CONDITIONS, build_return_features  # noqa: E402
from gating import StaticCombiner  # noqa: E402
from metrics import diebold_mariano, directional_accuracy, mae, rel_mae  # noqa: E402
from oof import blocked_oof_predictions  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BACKTEST_DAYS = 60
HORIZON = 10

FILES = {
    "aluminium": ROOT / "data" / "real_aluminium_daily.csv",
    "zinc": ROOT / "data" / "real_zinc_daily.csv",
}


def _append_dummy(raw, metal):
    """Append one placeholder row so the final REAL row survives the
    dropna in build_return_features (its target would otherwise be NaN).
    All features are backward-looking, so the placeholder cannot leak into
    the features of any real row."""
    out = raw.copy()
    last = out.iloc[-1]
    nxt = pd.DataFrame([{
        "date": last["date"] + pd.tseries.offsets.BDay(1),
        f"{metal}_close": last[f"{metal}_close"],
        f"{metal}_volume": np.nan,
    }])
    return pd.concat([out, nxt], ignore_index=True)


def build_for_metal(metal: str) -> dict:
    raw = pd.read_csv(FILES[metal], parse_dates=["date"])
    df, spec = build_return_features(raw, metal, **CONDITIONS["neither"])
    panel = default_panel()
    names = panel_names(panel)

    n = len(df)
    split = n - BACKTEST_DAYS

    # ---- honest out-of-sample backtest over the last BACKTEST_DAYS -----
    train_df = df.iloc[:split].reset_index(drop=True)
    oof, valid = blocked_oof_predictions(panel, train_df, spec)
    static = StaticCombiner().fit(oof[valid], train_df[spec.target_col].values[valid])

    fitted = fit_panel(panel, train_df, spec)
    test_idx = np.arange(split, n)
    test_preds = panel_predict(fitted, df, test_idx, spec)
    combined_ret = test_preds @ static.weights_

    y_true_ret = df[spec.target_col].values[test_idx]
    price_now = df[spec.price_col].values[test_idx]
    dates_next = list(df["date"].values[test_idx])

    actual_next = price_now * np.exp(y_true_ret)
    pred_next = price_now * np.exp(combined_ret)

    backtest = [
        {
            "date": pd.Timestamp(d).strftime("%Y-%m-%d"),
            "actual": round(float(a), 2),
            "predicted": round(float(p), 2),
        }
        for d, a, p in zip(dates_next, actual_next, pred_next)
    ]

    # ---- leaderboard on the same backtest window -----------------------
    rw_ret = np.zeros_like(y_true_ret)
    board = []
    series = {f"expert_{nm}": test_preds[:, i] for i, nm in enumerate(names)}
    series["Combined model"] = combined_ret
    series["Simple average"] = test_preds.mean(axis=1)
    series["Random walk"] = rw_ret

    pretty = {
        "expert_ridge_ar": "Linear model",
        "expert_arima": "Statistical model (ARIMA)",
        "expert_boosting": "Tree model (XGBoost)",
        "expert_sequence": "Neural network",
        "Combined model": "Combined model",
        "Simple average": "Simple average",
        "Random walk": "Doing nothing (random walk)",
    }

    for key, pred_ret in series.items():
        d = directional_accuracy(y_true_ret, pred_ret)
        p = (diebold_mariano(y_true_ret, pred_ret, rw_ret).p_value
             if key != "Random walk" else float("nan"))
        board.append({
            "name": pretty.get(key, key),
            "relmae": round(float(rel_mae(y_true_ret, pred_ret, rw_ret)), 4),
            "mae_pct": round(float(mae(y_true_ret, pred_ret)) * 100, 4),
            "diracc": None if np.isnan(d.accuracy) else round(float(d.accuracy), 4),
            "p_vs_rw": None if (p is None or np.isnan(p)) else round(float(p), 4),
            "is_baseline": key == "Random walk",
        })
    board.sort(key=lambda r: r["relmae"])

    # ---- forward projection with uncertainty --------------------------
    full_fitted = fit_panel(panel, df, spec)
    oof_full, valid_full = blocked_oof_predictions(panel, df, spec)
    static_full = StaticCombiner().fit(
        oof_full[valid_full], df[spec.target_col].values[valid_full])

    sigma = float(np.std(y_true_ret - combined_ret))

    work = raw.copy()
    projection = []
    cum_var = 0.0
    for h in range(1, HORIZON + 1):
        tmp = _append_dummy(work, metal)
        f2, s2 = build_return_features(tmp, metal, **CONDITIONS["neither"])
        idx = np.array([len(f2) - 1])
        step_preds = panel_predict(full_fitted, f2, idx, s2)
        r_hat = float(np.ravel(step_preds @ static_full.weights_)[0])

        last_price = float(work[f"{metal}_close"].iloc[-1])
        next_price = last_price * np.exp(r_hat)
        next_date = pd.Timestamp(work["date"].iloc[-1]) + pd.tseries.offsets.BDay(1)

        cum_var += sigma ** 2
        band = 1.2816 * np.sqrt(cum_var)   # 80% interval

        projection.append({
            "date": next_date.strftime("%Y-%m-%d"),
            "central": round(next_price, 2),
            "lo": round(last_price * np.exp(r_hat - band), 2),
            "hi": round(last_price * np.exp(r_hat + band), 2),
        })

        work = pd.concat([work, pd.DataFrame([{
            "date": next_date,
            f"{metal}_close": next_price,
            f"{metal}_volume": np.nan,
        }])], ignore_index=True)

    # ---- recent history for context ------------------------------------
    hist = raw.tail(120)
    history = [
        {"date": pd.Timestamp(d).strftime("%Y-%m-%d"), "price": round(float(p), 2)}
        for d, p in zip(hist["date"], hist[f"{metal}_close"])
    ]

    return {
        "metal": metal,
        "rows": int(len(raw)),
        "start": pd.Timestamp(raw["date"].min()).strftime("%Y-%m-%d"),
        "end": pd.Timestamp(raw["date"].max()).strftime("%Y-%m-%d"),
        "last_price": round(float(raw[f"{metal}_close"].iloc[-1]), 2),
        "history": history,
        "backtest": backtest,
        "projection": projection,
        "leaderboard": board,
        "backtest_days": BACKTEST_DAYS,
        "typical_daily_move_pct": round(float(np.mean(np.abs(y_true_ret))) * 100, 3),
    }


def main():
    data = {m: build_for_metal(m) for m in FILES}
    out = ROOT / "results" / "dashboard_data.json"
    out.write_text(json.dumps(data, indent=2))
    print(f"wrote {out}")
    for m, d in data.items():
        best = d["leaderboard"][0]
        print(f"\n{m}: {d['rows']} days, {d['start']} -> {d['end']}, "
              f"last {d['last_price']}")
        print(f"   best on backtest: {best['name']} "
              f"(relMAE {best['relmae']}, p vs random walk {best['p_vs_rw']})")
        print(f"   typical daily move: {d['typical_daily_move_pct']}%")


if __name__ == "__main__":
    main()
