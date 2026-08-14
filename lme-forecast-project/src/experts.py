"""
Base "expert" forecasters for the Mixture-of-Experts ensemble.

Three experts, each specializing in a different signal type:
  - ARIMAExpert    : linear trend/seasonality (statsmodels)
  - BoostingExpert  : nonlinear short-term patterns from engineered features (XGBoost)
  - SequenceExpert  : longer temporal dependencies from raw price windows

NOTE ON SequenceExpert: this sandbox doesn't have disk headroom for
PyTorch/TensorFlow, so SequenceExpert here is implemented as an MLP
(sklearn) over a flattened lag window — a reasonable stand-in that
captures *some* nonlinear sequential structure. For your actual paper,
swap this for a proper LSTM/GRU (PyTorch) on your own machine — the
gating/fusion code doesn't care what's inside an expert, only that it
exposes .fit(X, y) / .predict(X), so the swap is a drop-in replacement.
"""
import numpy as np
import pandas as pd
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import warnings

warnings.filterwarnings("ignore")


class ARIMAExpert:
    def __init__(self, order=(2, 1, 2)):
        self.order = order
        self.model_fit = None
        self.history = None

    def fit(self, y: pd.Series):
        from statsmodels.tsa.arima.model import ARIMA
        self.history = list(y.values)
        self.model_fit = ARIMA(self.history, order=self.order).fit()
        return self

    def predict_next(self) -> float:
        """One-step-ahead forecast from current history."""
        return float(self.model_fit.forecast(steps=1)[0])

    def rolling_predict(self, y: pd.Series) -> np.ndarray:
        """Walk-forward one-step forecasts across a series (slow but simple;
        for a semester project this is fine, refit every N steps if slow)."""
        preds = np.full(len(y), np.nan)
        from statsmodels.tsa.arima.model import ARIMA
        min_train = 60
        for i in range(min_train, len(y)):
            try:
                fit = ARIMA(y.values[:i], order=self.order).fit()
                preds[i] = fit.forecast(steps=1)[0]
            except Exception:
                preds[i] = y.values[i - 1]  # fallback: naive persistence
        return preds


class BoostingExpert:
    def __init__(self, **kwargs):
        params = dict(n_estimators=300, max_depth=4, learning_rate=0.05,
                      subsample=0.8, colsample_bytree=0.8, random_state=0)
        params.update(kwargs)
        self.model = xgb.XGBRegressor(**params)

    def fit(self, X: pd.DataFrame, y: pd.Series):
        self.model.fit(X, y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(X)


class SequenceExpert:
    """MLP over a flattened window of lagged returns — stand-in for an
    LSTM (see module docstring)."""

    def __init__(self, window=20, hidden_layer_sizes=(64, 32)):
        self.window = window
        self.scaler = StandardScaler()
        self.model = MLPRegressor(hidden_layer_sizes=hidden_layer_sizes,
                                   max_iter=2000, random_state=0,
                                   early_stopping=True)

    def _windowize(self, series: np.ndarray):
        X, y_idx = [], []
        for i in range(self.window, len(series)):
            X.append(series[i - self.window:i])
            y_idx.append(i)
        return np.array(X), np.array(y_idx)

    def fit(self, series: pd.Series):
        X, idx = self._windowize(series.values)
        y = series.values[idx]
        X = self.scaler.fit_transform(X)
        self.model.fit(X, y)
        return self

    def predict(self, series: pd.Series) -> np.ndarray:
        X, idx = self._windowize(series.values)
        X = self.scaler.transform(X)
        preds = self.model.predict(X)
        out = np.full(len(series), np.nan)
        out[idx] = preds
        return out


if __name__ == "__main__":
    df = pd.read_csv("../data/zinc_features.csv", parse_dates=["date"])

    print("Fitting BoostingExpert ...")
    feature_cols = [c for c in df.columns if "lag" in c or "ma" in c or "vol20" in c]
    be = BoostingExpert().fit(df[feature_cols].iloc[:-30], df["zinc_close"].iloc[:-30])
    preds = be.predict(df[feature_cols].iloc[-30:])
    print("BoostingExpert sample preds:", preds[:5])

    print("Fitting SequenceExpert (MLP stand-in) ...")
    se = SequenceExpert(window=20).fit(df["zinc_close"].iloc[:-30])
    seq_preds = se.predict(df["zinc_close"])
    print("SequenceExpert tail preds:", seq_preds[-5:])
