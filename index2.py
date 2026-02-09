import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score

# ==========================================
# STEP 1: Generate a Realistic "Kaggle-like" Dataset
# ==========================================
np.random.seed(42)  # For reproducibility
n_samples = 1000

# Generating features
size_sqft = np.random.normal(2000, 500, n_samples)  # Avg size 2000 sqft
num_rooms = np.random.randint(2, 6, n_samples)      # 2 to 5 rooms
age_years = np.random.randint(0, 30, n_samples)     # 0 to 30 years old
distance_city = np.random.uniform(1, 20, n_samples) # 1 to 20 km from city center

# Generating Price (Target) with a formula + some random noise
# Price = Base + (Size * 150) + (Rooms * 25000) - (Age * 2000) - (Distance * 3000) + Noise
price = (50000 + 
         (size_sqft * 150) + 
         (num_rooms * 25000) - 
         (age_years * 2000) - 
         (distance_city * 3000) + 
         np.random.normal(0, 15000, n_samples))

# Create DataFrame and save to CSV
df_create = pd.DataFrame({
    'Size_SqFt': size_sqft.astype(int),
    'Num_Rooms': num_rooms,
    'Age_Years': age_years,
    'Distance_City_km': np.round(distance_city, 1),
    'Price': np.round(price, 2)
})

csv_filename = 'kaggle_house_prices.csv'
df_create.to_csv(csv_filename, index=False)
print(f"Generated realistic dataset: {csv_filename} ({n_samples} rows)\n")

# ==========================================
# STEP 2: Load and Explore Data
# ==========================================
df = pd.read_csv(csv_filename)

# Feature Selection
features = ['Size_SqFt', 'Num_Rooms', 'Age_Years', 'Distance_City_km']
X = df[features]
y = df['Price']

print("--- Data Snapshot ---")
print(df.head())
print("\n--- Statistical Summary ---")
print(df.describe().round(2))

# ==========================================
# STEP 3: Train the Model
# ==========================================
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = LinearRegression()
model.fit(X_train, y_train)

# ==========================================
# STEP 4: Evaluate and Analyze
# ==========================================
y_pred = model.predict(X_test)

mse = mean_squared_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print("\n--- Model Performance ---")
print(f"R-Squared Score: {r2:.4f} (Closer to 1.0 is better)")
print(f"Root Mean Squared Error: ${np.sqrt(mse):,.2f}")

print("\n--- Feature Coefficients (What impacts price most?) ---")
coeff_df = pd.DataFrame(model.coef_, X.columns, columns=['Coefficient'])
print(coeff_df)

# ==========================================
# STEP 5: Advanced Visualizations
# ==========================================
plt.figure(figsize=(12, 5))

# Plot 1: Actual vs Predicted Prices
plt.subplot(1, 2, 1)
plt.scatter(y_test, y_pred, alpha=0.5, color='blue')
plt.plot([y.min(), y.max()], [y.min(), y.max()], 'r--', lw=2) # Perfect prediction line
plt.xlabel('Actual Price')
plt.ylabel('Predicted Price')
plt.title(f'Actual vs Predicted (R² = {r2:.2f})')

# Plot 2: Residual Plot (Errors)
# Good models have residuals randomly scattered around 0
residuals = y_test - y_pred
plt.subplot(1, 2, 2)
plt.scatter(y_pred, residuals, alpha=0.5, color='green')
plt.axhline(y=0, color='r', linestyle='--')
plt.xlabel('Predicted Price')
plt.ylabel('Residuals (Error)')
plt.title('Residual Plot (Checking for Patterns)')

plt.tight_layout()
plt.show()

# Plot 3: Distribution of Errors
plt.figure(figsize=(6, 4))
sns.histplot(residuals, kde=True, color='purple')
plt.title('Distribution of Residuals (Should be Bell-Shaped)')
plt.xlabel('Error Magnitude')
plt.show()