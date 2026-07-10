import pandas as pd
import json
import os

df = pd.read_csv('../../../../dataset/training_dataset.csv')
with open('../../../../dataset/model_artifact.json', 'r') as f:
    artifact = json.load(f)

first_row = df.iloc[0]
feature_names = artifact['feature_order']
means = artifact['feature_means']
stddevs = artifact['feature_stddevs']
coefs = artifact['coefficients']
intercept = artifact['intercept']

pred = intercept
for i, name in enumerate(feature_names):
    val = first_row.get(name, 0.0)
    if pd.isna(val): val = 0.0
    scale = stddevs[i] if stddevs[i] != 0 else 1.0
    scaled = (val - means[i]) / scale
    pred += scaled * coefs[i]

print(f"Python Reconstructed Prediction (Row 1): {pred:.8f}")
