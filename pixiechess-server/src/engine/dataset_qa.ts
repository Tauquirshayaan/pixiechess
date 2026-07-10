import * as fs from 'fs';
import * as path from 'path';

const DATASET_PATH = path.resolve(__dirname, '../../../../dataset/training_dataset.csv');

function run() {
    if (!fs.existsSync(DATASET_PATH)) {
        console.error("Dataset not found at " + DATASET_PATH);
        return;
    }
    
    const lines = fs.readFileSync(DATASET_PATH, 'utf-8').trim().split('\n');
    if (lines.length <= 1) {
        console.error("Dataset is empty.");
        return;
    }
    
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map(l => l.split(','));
    
    const missingCounts: Record<string, number> = {};
    headers.forEach(h => missingCounts[h] = 0);
    
    const numericData: Record<string, number[]> = {};
    
    rows.forEach(row => {
        row.forEach((val, i) => {
            const h = headers[i];
            if (!val || val === '""' || val === 'NaN' || val === 'null') {
                missingCounts[h]++;
            } else if (!isNaN(Number(val))) {
                if (!numericData[h]) numericData[h] = [];
                numericData[h].push(Number(val));
            }
        });
    });
    
    console.log("=== Dataset QA Report ===");
    console.log(`Total Rows: ${rows.length}`);
    console.log("\n--- Missing Value Percentages ---");
    headers.forEach(h => {
        const pct = (missingCounts[h] / rows.length) * 100;
        if (pct > 0) {
            console.log(`${h}: ${pct.toFixed(2)}%`);
        }
    });
    
    console.log("\n--- Summary Statistics ---");
    for (const h in numericData) {
        const data = numericData[h];
        if (data.length === 0) continue;
        const sum = data.reduce((a, b) => a + b, 0);
        const mean = sum / data.length;
        const min = Math.min(...data);
        const max = Math.max(...data);
        const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length;
        const std = Math.sqrt(variance);
        console.log(`${h} | Mean: ${mean.toFixed(3)} | Std: ${std.toFixed(3)} | Min: ${min.toFixed(3)} | Max: ${max.toFixed(3)}`);
    }
    
    console.log("\n--- Heuristic Classification Distributions ---");
    const hKeys = rows.map(r => r[headers.indexOf('heuristic_key')]);
    const uniqueKeys = new Set(hKeys);
    console.log(`Unique Heuristics: ${uniqueKeys.size}`);
    
    console.log("\nReady for Ridge Regression Pipeline!");
}

run();
