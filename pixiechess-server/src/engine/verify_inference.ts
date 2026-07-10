import * as fs from 'fs';
import * as path from 'path';
import { RidgePredictor } from './ridge_inference';

const ARTIFACT_PATH = path.resolve(__dirname, '../../../../dataset/model_artifact.json');
const DATASET_PATH = path.resolve(__dirname, '../../../../dataset/training_dataset.csv');

function parseCSV(line: string, headers: string[]): Record<string, number> {
    const values = line.split(',');
    const obj: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
        let val = values[i];
        if (val === '""' || val === '' || val === 'NaN' || val === 'null') {
            obj[headers[i]] = NaN;
        } else {
            obj[headers[i]] = Number(val);
        }
    }
    return obj;
}

function run() {
    console.log("=== Testing Ridge Inference Parity ===");
    
    const predictor = new RidgePredictor();
    if (!predictor.loadModel(ARTIFACT_PATH)) {
        return;
    }
    
    console.log(`Model Loaded. Hash: ${predictor.getFeatureHash()}`);
    
    const lines = fs.readFileSync(DATASET_PATH, 'utf-8').trim().split('\n');
    const headers = lines[0].split(',');
    
    const firstRowStr = lines[1];
    const firstRowFeatures = parseCSV(firstRowStr, headers);
    
    const prediction = predictor.predict(firstRowFeatures);
    
    console.log(`\nTypeScript Prediction (Row 1): ${prediction.toFixed(8)}`);
    console.log(`Compare this manually with Python's pipeline.predict(X)[0] output!`);
}

run();
