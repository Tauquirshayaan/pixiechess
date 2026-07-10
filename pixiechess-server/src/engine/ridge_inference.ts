import * as fs from 'fs';

export interface ModelArtifact {
    schema_version: string;
    model_type: string;
    alpha: number;
    feature_hash: string;
    feature_order: string[];
    feature_means: number[];
    feature_stddevs: number[];
    coefficients: number[];
    intercept: number;
    training_metadata: any;
}

export class RidgePredictor {
    private artifact: ModelArtifact | null = null;
    
    public loadModel(artifactPath: string): boolean {
        try {
            const raw = fs.readFileSync(artifactPath, 'utf-8');
            const data = JSON.parse(raw) as ModelArtifact;
            
            if (data.model_type !== 'ridge') {
                throw new Error(`Unsupported model_type: ${data.model_type}`);
            }
            
            const n = data.feature_order.length;
            if (data.feature_means.length !== n || data.feature_stddevs.length !== n || data.coefficients.length !== n) {
                throw new Error("Artifact array lengths do not match feature_order length.");
            }
            
            this.artifact = data;
            return true;
        } catch (e) {
            console.error(`Failed to load Ridge artifact from ${artifactPath}:`, e);
            return false;
        }
    }
    
    public getFeatureHash(): string | null {
        return this.artifact ? this.artifact.feature_hash : null;
    }
    
    public predict(features: Record<string, number>): number {
        if (!this.artifact) {
            throw new Error("RidgePredictor not initialized. Call loadModel() first.");
        }
        
        let prediction = this.artifact.intercept;
        
        for (let i = 0; i < this.artifact.feature_order.length; i++) {
            const key = this.artifact.feature_order[i];
            
            // Treat missing as 0 (matching the ML imputation logic)
            let rawValue = features[key];
            if (rawValue === undefined || rawValue === null || isNaN(rawValue)) {
                rawValue = 0.0;
            }
            
            const mean = this.artifact.feature_means[i];
            const std = this.artifact.feature_stddevs[i];
            
            // Z-score standardization: (val - mean) / scale
            // Scikit-learn StandardScaler protects against div-by-zero implicitly, std is usually > 0
            const scale = std === 0 ? 1 : std;
            const scaledValue = (rawValue - mean) / scale;
            
            const coef = this.artifact.coefficients[i];
            prediction += scaledValue * coef;
        }
        
        return prediction;
    }
}
