import argparse
import hashlib
import json
import logging
import os
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupShuffleSplit
from scipy.stats import spearmanr, pearsonr, kendalltau

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

FEATURE_COLUMNS = [
    "cf.delta_signed", "cf.delta_abs", "cf.cohens_d", 
    "cf.delta_standard_error", "cf.delta_ci_width", "cf.relative_ci_width",
    "activation.persistence_pct", "activation.half_life", 
    "activation.activation_rate", "activation.reactivation_rate",
    "search.node_ratio", "search.node_growth", "search.qnode_growth", "search.beta_growth",
    "search.pv_persistence_delta", "search.pv_entropy_delta",
    "search.root_change_rate", "search.exposure_root_change_rate",
    "search.elasticity",
    "trajectory.minus8", "trajectory.minus4", "trajectory.minus2",
    "trajectory.plus2", "trajectory.plus4", "trajectory.plus8",
    "stability.amplitude", "stability.stddev",
    "metadata.effective_activation_rate", "metadata.low_impact_rate"
]

def generate_mock_target(df: pd.DataFrame, seed: int = 42) -> pd.Series:
    np.random.seed(seed)
    # deterministic mock logic: target = 0.5 * cf.delta_signed - 0.001 * search.node_growth + N(0, 15)
    cf_delta = df.get('cf.delta_signed', pd.Series(np.zeros(len(df))))
    node_growth = df.get('search.node_growth', pd.Series(np.zeros(len(df))))
    
    cf_delta = cf_delta.fillna(0)
    node_growth = node_growth.fillna(0)
    
    noise = np.random.normal(0, 15.0, size=len(df))
    return 0.5 * cf_delta - 0.001 * node_growth + noise

def calculate_metrics(y_true, y_pred):
    metrics = {}
    metrics['rmse'] = float(np.sqrt(np.mean((y_true - y_pred)**2)))
    metrics['mae'] = float(np.mean(np.abs(y_true - y_pred)))
    
    ss_res = np.sum((y_true - y_pred)**2)
    ss_tot = np.sum((y_true - np.mean(y_true))**2)
    metrics['r2'] = float(1 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
    
    try:
        metrics['spearman'] = float(spearmanr(y_true, y_pred)[0])
        metrics['pearson'] = float(pearsonr(y_true, y_pred)[0])
        metrics['kendall'] = float(kendalltau(y_true, y_pred)[0])
    except Exception as e:
        metrics['spearman'] = 0.0
        metrics['pearson'] = 0.0
        metrics['kendall'] = 0.0
        
    return metrics

def run_pipeline(args):
    dataset_path = args.dataset
    if not os.path.exists(dataset_path):
        logger.error(f"Dataset not found at {dataset_path}")
        return

    logger.info("Loading dataset...")
    df = pd.read_csv(dataset_path)
    
    if args.target == "mock":
        logger.info("Generating deterministic mock Elo target...")
        df['target'] = generate_mock_target(df)
    else:
        if 'measured_elo' not in df.columns:
            logger.error("measured_elo not found in dataset for --target measured")
            return
        df['target'] = df['measured_elo']
    
    # Validation & NaN drop
    available_features = [f for f in FEATURE_COLUMNS if f in df.columns]
    
    # Drop rows where target is missing
    df = df.dropna(subset=['target', 'run_id'])
    
    # For now, fill missing feature values with 0 so the pipeline can run,
    # or drop rows? Usually we impute, but for v1 let's fillna with 0 for missing features (like trajectory logic missing).
    X_full = df[available_features].fillna(0.0)
    y_full = df['target'].values
    weights_full = df.get('metadata.training_weight', pd.Series(np.ones(len(df)))).fillna(1.0).values
    run_ids = df['run_id'].values
    
    # Drop zero variance columns
    variances = X_full.var()
    keep_cols = variances[variances > 1e-9].index.tolist()
    removed_cols = set(available_features) - set(keep_cols)
    if removed_cols:
        logger.info(f"Dropping {len(removed_cols)} zero-variance features: {removed_cols}")
    
    X_full = X_full[keep_cols]
    final_feature_names = X_full.columns.tolist()
    
    # Train/Val/Test Split using GroupShuffleSplit (by run_id)
    gss_test = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=42)
    train_val_idx, test_idx = next(gss_test.split(X_full, y_full, run_ids))
    
    X_train_val, y_train_val = X_full.iloc[train_val_idx], y_full[train_val_idx]
    w_train_val, run_ids_train_val = weights_full[train_val_idx], run_ids[train_val_idx]
    X_test, y_test = X_full.iloc[test_idx], y_full[test_idx]
    w_test = weights_full[test_idx]
    
    # Inner split for Val
    gss_val = GroupShuffleSplit(n_splits=1, test_size=0.15/0.85, random_state=42)
    train_idx, val_idx = next(gss_val.split(X_train_val, y_train_val, run_ids_train_val))
    
    X_train, y_train = X_train_val.iloc[train_idx], y_train_val[train_idx]
    w_train = w_train_val[train_idx]
    X_val, y_val = X_train_val.iloc[val_idx], y_train_val[val_idx]
    w_val = w_train_val[val_idx]
    
    logger.info(f"Split sizes -> Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
    
    # Normalize weights (mean = 1.0)
    w_train = w_train / (np.mean(w_train) + 1e-9)
    
    # Build Pipeline
    alphas = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 3e-1, 1.0, 3.0, 10.0, 30.0, 100.0]
    
    pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('ridge', RidgeCV(alphas=alphas, cv=None))  # LOOCV is default which is efficient
    ])
    
    logger.info("Fitting Ridge Pipeline...")
    
    # RidgeCV doesn't natively accept sample_weight in the pipeline fit directly easily without a custom wrapper in older versions,
    # but we can pass fit_params to the final estimator.
    fit_params = {'ridge__sample_weight': w_train}
    pipeline.fit(X_train, y_train, **fit_params)
    
    ridge_model = pipeline.named_steps['ridge']
    scaler = pipeline.named_steps['scaler']
    best_alpha = ridge_model.alpha_
    
    logger.info(f"Best Alpha selected: {best_alpha}")
    
    # Evaluation
    def eval_fold(name, X, y):
        preds = pipeline.predict(X)
        metrics = calculate_metrics(y, preds)
        logger.info(f"--- {name} Evaluation ---")
        for k, v in metrics.items():
            logger.info(f"  {k.upper()}: {v:.4f}")
        return preds
        
    eval_fold("TRAIN", X_train, y_train)
    val_preds = eval_fold("VALIDATION", X_val, y_val)
    test_preds = eval_fold("TEST", X_test, y_test)
    
    # Top 5 Residuals on Validation
    residuals = np.abs(y_val - val_preds)
    top_5_idx = np.argsort(residuals)[-5:][::-1]
    logger.info("--- Top 5 Validation Residuals ---")
    val_heuristic_keys = df.iloc[train_val_idx].iloc[val_idx].get('heuristic_key', pd.Series(["unknown"]*len(X_val))).values
    for i in top_5_idx:
        logger.info(f"Heuristic '{val_heuristic_keys[i]}': True={y_val[i]:.2f}, Pred={val_preds[i]:.2f}, Err={residuals[i]:.2f}")
        
    # Coefficient Diagnostics
    coefs = ridge_model.coef_
    l2_norm = np.sqrt(np.sum(coefs**2))
    near_zero = np.sum(np.abs(coefs) < 1e-4)
    logger.info("--- Coefficient Diagnostics ---")
    logger.info(f"L2 Norm: {l2_norm:.4f}")
    logger.info(f"Near-Zero Coefs (<1e-4): {near_zero} / {len(coefs)}")
    
    sort_idx = np.argsort(coefs)
    logger.info(f"Top 3 Positive Coefs: {[f'{final_feature_names[i]}: {coefs[i]:.4f}' for i in sort_idx[-3:]]}")
    logger.info(f"Top 3 Negative Coefs: {[f'{final_feature_names[i]}: {coefs[i]:.4f}' for i in sort_idx[:3]]}")
    
    logger.info("--- Human-Readable Coefficient Table ---")
    logger.info(f"{'Feature':<35} | {'Coefficient':>12}")
    logger.info("-" * 50)
    for i in np.argsort(np.abs(coefs))[::-1]:  # Sorted by absolute magnitude
        logger.info(f"{final_feature_names[i]:<35} | {coefs[i]:>12.4f}")
    
    # Generate feature schema hash
    feature_string = ",".join(final_feature_names)
    feature_hash = "sha256:" + hashlib.sha256(feature_string.encode('utf-8')).hexdigest()
    
    # Export Model Artifact
    artifact = {
        "schema_version": "1.0.0",
        "model_type": "ridge",
        "alpha": float(best_alpha),
        "feature_hash": feature_hash,
        "feature_order": final_feature_names,
        "feature_means": scaler.mean_.tolist(),
        "feature_stddevs": scaler.scale_.tolist(),
        "coefficients": coefs.tolist(),
        "intercept": float(ridge_model.intercept_),
        "training_metadata": {
            "dataset_version": "1.1.0",
            "target_type": args.target,
            "feature_count": len(final_feature_names),
            "train_samples": len(X_train),
            "validation_samples": len(X_val),
            "test_samples": len(X_test),
            "random_seed": 42
        }
    }
    
    out_path = os.path.join(os.path.dirname(dataset_path), 'model_artifact.json')
    with open(out_path, 'w') as f:
        json.dump(artifact, f, indent=2)
    logger.info(f"Model exported to {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="Path to training_dataset.csv")
    parser.add_argument("--target", choices=["measured", "mock"], default="mock", help="Target variable generation")
    args = parser.parse_args()
    
    run_pipeline(args)
