"""
Expert panel for the return-target setting, behind one uniform interface.

The original `experts.py` gave each expert a different signature (ARIMA
took a series, XGBoost took a matrix, the sequence model took a series and
returned a NaN-padded array), which is why `train.py` ended up hand-wiring
each one and why `ARIMAExpert` was quietly never called. Here every expert
implements the same two methods, so the panel is a list and adding or
removing an expert changes nothing downstream.

    fit(train_df, spec)              -> self
    predict(full_df, row_idx, spec)  -> (len(row_idx),) predictions

`predict` takes the FULL frame plus the row positions to score, rather
than a slice. That is what lets the ARIMA expert produce genuine
one-step-ahead forecasts -- it needs the contiguous return history up to
each scored row, which a detached slice cannot provide. Parameters are
always estimated on the training window only; only *observations* extend
into the scored region, which is standard one-step-ahead practice and not
lookahead.

The panel deliberately EXCLUDES a random-walk member. In the original
pipeline the third "expert" was `shift(1)` -- identical to the naive
baseline it was being compared against, so the ensemble was competing with
its own benchmark. The random walk lives in `experiment.py` as a benchmark
only.
"""
import warnings

import numpy as np
import pandas as pd
from sklearn.compose import TransformedTargetRegressor
from sklearn.linear_model import Ridge
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
import xgboost as xgb

warnings.filterwarnings("ignore")


class Expert:
    """Interface. Subclasses set `name` and implement `_fit` / `_predict`."""
    name = "expert"

    def fit(self, train_df: pd.DataFrame, spec):
        raise NotImplementedError

    def predict(self, full_df: pd.DataFrame, row_idx: np.ndarray, spec) -> np.ndarray:
        raise NotImplementedError

    def clone(self):
        return self.__class__(**self._params())

    def _params(self) -> dict:
        return {}


class RidgeARExpert(Expert):
    """Linear autoregression on the lagged-return block.

    Deliberately restricted to the plain return lags -- no magnitudes, no
    volatility terms -- so it is a genuinely *linear* hypothesis class.
    This is the expert that should win in the linear regime of the
    synthetic testbed and lose in the threshold regime, which is what
    makes routing between it and the tree meaningful.
    """
    name = "ridge_ar"

    def __init__(self, alpha: float = 1.0):
        self.alpha = alpha
        self.model = make_pipeline(StandardScaler(), Ridge(alpha=alpha))
        self.cols = None

    def _params(self):
        return {"alpha": self.alpha}

    def _linear_cols(self, spec):
        return [c for c in spec.expert_cols if "_ret_lag" in c]

    def fit(self, train_df, spec):
        self.cols = self._linear_cols(spec)
        self.model.fit(train_df[self.cols], train_df[spec.target_col])
        return self

    def predict(self, full_df, row_idx, spec):
        return self.model.predict(full_df.iloc[row_idx][self.cols])


class BoostingExpert(Expert):
    """Gradient-boosted trees over the full engineered feature set.

    Piecewise-constant hypothesis class: can represent the threshold
    interaction the linear expert structurally cannot.
    """
    name = "boosting"

    def __init__(self, n_estimators=400, max_depth=4, learning_rate=0.05,
                 subsample=0.8, colsample_bytree=0.8, random_state=0):
        self.kwargs = dict(n_estimators=n_estimators, max_depth=max_depth,
                           learning_rate=learning_rate, subsample=subsample,
                           colsample_bytree=colsample_bytree,
                           random_state=random_state, verbosity=0)
        self.model = xgb.XGBRegressor(**self.kwargs)

    def _params(self):
        return {k: v for k, v in self.kwargs.items() if k != "verbosity"}

    def fit(self, train_df, spec):
        self.model.fit(train_df[spec.expert_cols], train_df[spec.target_col])
        return self

    def predict(self, full_df, row_idx, spec):
        return self.model.predict(full_df.iloc[row_idx][spec.expert_cols])


class SequenceExpert(Expert):
    """MLP over the lagged-return window -- the LSTM stand-in.

    Smooth nonlinear hypothesis class, distinct from the tree's piecewise
    one. The README's promise holds: swapping this for a PyTorch LSTM
    requires only that the replacement implement `fit` / `predict`.

    TARGET SCALING is essential here and was missing from the original.
    Daily log returns have magnitude ~1e-2, and an MLP with a linear output
    layer and default L2 initialisation cannot resolve a target that small
    -- it converges to something near the mean and stays there. In the
    first run of this panel the unscaled MLP scored MAE 0.049 against 0.010
    for every other expert, and dragged the simple average to 1.51x the
    random walk on its own. Wrapping the regressor so the target is
    standardised for fitting and inverse-transformed for prediction fixes
    it. This is a scaling bug, not evidence that sequence models are
    unsuited to the task, and reporting it as the latter would have been a
    real error in the paper.

    `early_stopping` is off for the same reason as in the gate: it holds
    out a slice of an already-short window and halts on a noisy score.
    """
    name = "sequence"

    def __init__(self, hidden_layer_sizes=(64, 32), alpha=1e-3, random_state=0):
        self.hidden_layer_sizes = hidden_layer_sizes
        self.alpha = alpha
        self.random_state = random_state
        self.model = TransformedTargetRegressor(
            regressor=make_pipeline(
                StandardScaler(),
                MLPRegressor(hidden_layer_sizes=hidden_layer_sizes, alpha=alpha,
                             max_iter=1500, random_state=random_state,
                             early_stopping=False),
            ),
            transformer=StandardScaler(),
        )

    def _params(self):
        return {"hidden_layer_sizes": self.hidden_layer_sizes,
                "alpha": self.alpha, "random_state": self.random_state}

    def fit(self, train_df, spec):
        self.model.fit(train_df[spec.expert_cols], train_df[spec.target_col])
        return self

    def predict(self, full_df, row_idx, spec):
        return self.model.predict(full_df.iloc[row_idx][spec.expert_cols])


class ARIMAExpert(Expert):
    """ARIMA on the return series, one-step-ahead with fixed parameters.

    Wired into the pipeline for the first time -- the proposal's Expert A
    existed in the original codebase but was never imported by `train.py`,
    so it appeared in no reported result.

    Parameters are estimated on the training window, then the fitted
    parameters are applied to the full series via `.filter()`. The
    resulting `fittedvalues[k]` is E[r_k | r_0..r_{k-1}], a true one-step
    forecast. Row t of the frame carries target r_{t+1}, so the prediction
    for row t is `fittedvalues[t+1]`.
    """
    name = "arima"

    def __init__(self, order=(2, 0, 1)):
        self.order = order
        self.params_ = None
        self.fallback_ = 0.0

    def _params(self):
        return {"order": self.order}

    def fit(self, train_df, spec):
        from statsmodels.tsa.arima.model import ARIMA
        y = train_df[spec.return_col].values.astype(float)
        try:
            res = ARIMA(y, order=self.order).fit()
            self.params_ = res.params
        except Exception:
            self.params_ = None
            self.fallback_ = float(np.mean(y))
        return self

    def predict(self, full_df, row_idx, spec):
        row_idx = np.asarray(row_idx)
        if self.params_ is None:
            return np.full(len(row_idx), self.fallback_)

        from statsmodels.tsa.arima.model import ARIMA
        y_full = full_df[spec.return_col].values.astype(float)
        try:
            res_full = ARIMA(y_full, order=self.order).filter(self.params_)
            fv = np.asarray(res_full.fittedvalues, dtype=float)
        except Exception:
            return np.full(len(row_idx), self.fallback_)

        # prediction for row t is the one-step-ahead value at t+1
        nxt = np.clip(row_idx + 1, 0, len(fv) - 1)
        out = fv[nxt]
        return np.nan_to_num(out, nan=self.fallback_, posinf=0.0, neginf=0.0)


def default_panel() -> list:
    """The four experts used throughout the experiments.

    Two linear-ish (ridge AR, ARIMA) and two nonlinear (trees, MLP), which
    is the minimum needed for regime-dependent specialization to be a real
    phenomenon rather than a relabelling of one model.
    """
    return [RidgeARExpert(), ARIMAExpert(), BoostingExpert(), SequenceExpert()]


def panel_names(panel) -> list:
    return [e.name for e in panel]


def fit_panel(panel, train_df, spec) -> list:
    return [e.clone().fit(train_df, spec) for e in panel]


def panel_predict(fitted, full_df, row_idx, spec) -> np.ndarray:
    """Stack expert predictions into (len(row_idx), n_experts)."""
    return np.column_stack([e.predict(full_df, row_idx, spec) for e in fitted])
