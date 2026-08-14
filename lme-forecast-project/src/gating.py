"""
Gating network — the core novel contribution of this project.

Approach: "oracle-supervised soft gating."
  1. For each historical timestep, compute each expert's trailing rolling
     error (already in the gate state vector from features.py).
  2. Derive "oracle weights" = softmax(-trailing_error / temperature), i.e.
     experts that have been more accurate recently get more weight. This
     gives a supervised target for the gate to learn from.
  3. Train a small neural network (MLPRegressor, softmax-normalized output)
     to predict these oracle weights from the FULL market-state vector
     (volatility, Hurst/regime, inventory-pressure-index, trailing errors).
  4. At inference, the gate only needs the state vector (not future
     errors) to produce weights, then combine expert predictions.

Why this design: it sidesteps needing a deep-learning framework with
autograd for a fully end-to-end joint loss (impractical in this sandbox),
while still producing a genuinely dynamic, learned, input-conditioned
gating function — the defining property of an MoE architecture. If you
have PyTorch available on your own machine, the natural extension
(documented in the README) is to replace this with joint end-to-end
training of experts + gate under a single loss.
"""
import numpy as np
import pandas as pd
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler


def softmax(x: np.ndarray, axis=-1) -> np.ndarray:
    x = x - np.max(x, axis=axis, keepdims=True)
    e = np.exp(x)
    return e / np.sum(e, axis=axis, keepdims=True)


def compute_oracle_weights(expert_preds: np.ndarray, y_true: np.ndarray,
                            trail_window=10, temperature=1.0) -> np.ndarray:
    """
    expert_preds: shape (T, n_experts)
    y_true:       shape (T,)
    Returns oracle_weights: shape (T, n_experts), softmax over negative
    trailing absolute error (lower recent error -> higher weight).
    """
    T, n_experts = expert_preds.shape
    abs_err = np.abs(expert_preds - y_true[:, None])  # (T, n_experts)
    trailing_err = pd.DataFrame(abs_err).rolling(trail_window, min_periods=1).mean().values
    oracle = softmax(-trailing_err / temperature, axis=1)
    return oracle


class GatingNetwork:
    def __init__(self, hidden_layer_sizes=(32, 16), temperature=1.0, trail_window=10):
        self.scaler = StandardScaler()
        self.model = MLPRegressor(hidden_layer_sizes=hidden_layer_sizes,
                                   max_iter=3000, random_state=0,
                                   early_stopping=True)
        self.temperature = temperature
        self.trail_window = trail_window
        self.n_experts = None

    def fit(self, state_vector: pd.DataFrame, expert_preds: np.ndarray, y_true: np.ndarray):
        self.n_experts = expert_preds.shape[1]
        oracle_weights = compute_oracle_weights(
            expert_preds, y_true, trail_window=self.trail_window,
            temperature=self.temperature,
        )
        X = self.scaler.fit_transform(state_vector.values)
        # MLPRegressor supports multi-output regression natively
        self.model.fit(X, oracle_weights)
        return self

    def predict_weights(self, state_vector: pd.DataFrame) -> np.ndarray:
        X = self.scaler.transform(state_vector.values)
        raw = self.model.predict(X)
        raw = np.atleast_2d(raw)
        return softmax(raw, axis=1)  # re-normalize; MLP output isn't guaranteed to sum to 1

    def combine(self, state_vector: pd.DataFrame, expert_preds: np.ndarray) -> np.ndarray:
        weights = self.predict_weights(state_vector)
        return np.sum(weights * expert_preds, axis=1), weights


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    T, n_experts = 500, 3
    y_true = np.cumsum(rng.normal(0, 1, T)) + 100
    expert_preds = y_true[:, None] + rng.normal(0, [1, 3, 5], size=(T, n_experts))
    state = pd.DataFrame({
        "vol": rng.normal(0, 1, T),
        "hurst": rng.normal(0.5, 0.1, T),
        "inv_pressure": rng.normal(0, 1, T),
    })

    gate = GatingNetwork().fit(state, expert_preds, y_true)
    combined, weights = gate.combine(state, expert_preds)
    mae_gate = np.mean(np.abs(combined - y_true))
    mae_best_single = min(np.mean(np.abs(expert_preds[:, i] - y_true)) for i in range(n_experts))
    mae_simple_avg = np.mean(np.abs(expert_preds.mean(axis=1) - y_true))
    print(f"Gate MAE: {mae_gate:.3f} | Best single expert MAE: {mae_best_single:.3f} | Simple avg MAE: {mae_simple_avg:.3f}")
    print("Sample gate weights:\n", weights[:5])
