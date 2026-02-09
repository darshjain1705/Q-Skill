import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

# --- STEP 1: Create the "Gym Fitness" CSV File ---
data = {
    'Member_ID': range(101, 121),
    'Age': [25, 30, 22, 35, 40, 28, 45, 24, 33, 50, 29, 31, 26, 42, 38, 27, 48, 23, 36, 55],
    'Weight_kg': [70, 80, 65, 85, 90, 75, 95, 68, 78, 88, 72, 82, 69, 92, 84, 74, 96, 66, 86, 89],
    'Height_cm': [175, 180, 165, 178, 182, 170, 185, 168, 176, 179, 172, 181, 174, 183, 177, 173, 184, 167, 180, 178],
    'Workout_Hours_Week': [5, 3, 6, 2, 4, 5, 2, 7, 3, 1, 6, 4, 5, 2, 3, 5, 1, 8, 3, 2],
    'Calories_Burned_Avg': [500, 350, 600, 250, 450, 520, 280, 700, 380, 150, 620, 480, 510, 290, 390, 530, 180, 750, 370, 260],
    'Fat_Percentage': [18, 22, 15, 25, 24, 19, 28, 14, 21, 30, 17, 20, 18, 26, 23, 18, 29, 12, 22, 28]
}

df_create = pd.DataFrame(data)
df_create.to_csv('gym_members.csv', index=False)
print("Created 'gym_members.csv' successfully.\n")

# --- STEP 2: Load and Analyze Data ---
df = pd.read_csv('gym_members.csv')

# Display first few rows
print("Dataset Head:")
print(df.head())

# Basic Analysis: Average Calories Burned
avg_calories = df['Calories_Burned_Avg'].mean()
print(f"\nAverage Calories Burned per Session: {avg_calories:.2f}")

# --- STEP 3: Visualizations ---

# 1. Heatmap: Correlation Matrix (The specific request)
plt.figure(figsize=(10, 8))
# Select only numerical columns for correlation
numerical_df = df[['Age', 'Weight_kg', 'Height_cm', 'Workout_Hours_Week', 'Calories_Burned_Avg', 'Fat_Percentage']]
corr_matrix = numerical_df.corr()

sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', fmt=".2f", linewidths=0.5)
plt.title('Correlation Heatmap: Gym Fitness Variables')
plt.show()

# 2. Scatter Plot: Workout Hours vs. Fat Percentage
plt.figure(figsize=(8, 5))
plt.scatter(df['Workout_Hours_Week'], df['Fat_Percentage'], color='purple', alpha=0.7)
plt.xlabel('Workout Hours per Week')
plt.ylabel('Body Fat Percentage (%)')
plt.title('Impact of Workout Frequency on Body Fat')
plt.grid(True, linestyle='--', alpha=0.6)
plt.show()

# 3. Bar Chart: Average Weight by Age Group (Simple binning for visualization)
# Creating a temporary column for Age Groups just for this chart
df['Age_Group'] = pd.cut(df['Age'], bins=[20, 30, 40, 50, 60], labels=['20-30', '30-40', '40-50', '50+'])
avg_weight_by_age = df.groupby('Age_Group', observed=False)['Weight_kg'].mean()

plt.figure(figsize=(8, 5))
avg_weight_by_age.plot(kind='bar', color='teal', edgecolor='black')
plt.xlabel('Age Group')
plt.ylabel('Average Weight (kg)')
plt.title('Average Weight by Age Group')
plt.xticks(rotation=0)
plt.show()

# --- STEP 4: Insights ---
print("\n--- Insights ---")
print("1. Heatmap: Strong positive correlation between 'Workout_Hours_Week' and 'Calories_Burned_Avg'.")
print("2. Heatmap: Negative correlation between 'Workout_Hours_Week' and 'Fat_Percentage' (more workout = less fat).")
print("3. Scatter Plot: Confirms that individuals who workout more hours tend to have lower body fat percentages.")