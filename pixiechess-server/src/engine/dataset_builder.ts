import * as fs from 'fs';
import * as path from 'path';

const EXPERIMENTS_DIR = path.resolve(__dirname, '../../../../experiments');
const DATASET_DIR = path.resolve(__dirname, '../../../../dataset');
const VALIDATION_REPORT_PATH = path.join(DATASET_DIR, 'validation_report.json');
const DATASET_MANIFEST_PATH = path.join(DATASET_DIR, 'dataset_manifest.json');
const JSONL_OUT = path.join(DATASET_DIR, 'training_dataset.jsonl');
const CSV_OUT = path.join(DATASET_DIR, 'training_dataset.csv');

if (!fs.existsSync(DATASET_DIR)) {
    fs.mkdirSync(DATASET_DIR, { recursive: true });
}

interface ValidationReport {
    run_id: string;
    status: 'failed';
    errors: {
        heuristic: string;
        field: string;
        message: string;
    }[];
}

function flattenObject(ob: any): any {
    let toReturn: any = {};
    for (let i in ob) {
        if (!ob.hasOwnProperty(i)) continue;
        
        // Exclude specific UI/metadata fields from the ML dataset
        if (i === 'heuristic_ranking_score' || i === 'classification' || i.endsWith('_missing_reason')) {
            continue; 
        }

        if ((typeof ob[i]) == 'object' && ob[i] !== null && !Array.isArray(ob[i])) {
            let flatObject = flattenObject(ob[i]);
            for (let x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;
                toReturn[i + '.' + x] = flatObject[x];
            }
        } else {
            toReturn[i] = ob[i];
        }
    }
    return toReturn;
}

function run() {
    const runs = fs.readdirSync(EXPERIMENTS_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    let runsScanned = 0;
    let runsValid = 0;
    let runsRejected = 0;
    let featureRows = 0;
    const schemaVersions = new Set<string>();
    
    const validationReports: ValidationReport[] = [];
    const validFeatures: any[] = [];
    
    console.log(`Scanning ${runs.length} experiment directories...`);

    for (const run_id of runs) {
        const runDir = path.join(EXPERIMENTS_DIR, run_id);
        const manifestPath = path.join(runDir, 'manifest.json');
        const featuresPath = path.join(runDir, 'heuristic_features.json');
        const sprtPath = path.join(runDir, 'sprt_results.json');
        
        if (!fs.existsSync(manifestPath) || !fs.existsSync(featuresPath)) {
            continue; 
        }
        
        runsScanned++;
        
        let manifest: any, featureData: any, sprtData: any = null;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            featureData = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
            if (fs.existsSync(sprtPath)) {
                sprtData = JSON.parse(fs.readFileSync(sprtPath, 'utf-8'));
            }
        } catch (e) {
            runsRejected++;
            validationReports.push({
                run_id, status: 'failed',
                errors: [{ heuristic: 'global', field: 'json_parse', message: 'Failed to parse JSON artifacts' }]
            });
            continue;
        }

        const errors: {heuristic: string, field: string, message: string}[] = [];
        
        if (featureData.schema_version !== '1.0.0' && featureData.schema_version !== '1.0') {
            errors.push({ heuristic: 'global', field: 'schema_version', message: `Unsupported schema version: ${featureData.schema_version}` });
        } else {
            schemaVersions.add(featureData.schema_version);
        }

        const seenKeys = new Set<string>();

        if (!Array.isArray(featureData.features)) {
            errors.push({ heuristic: 'global', field: 'features', message: 'features array is missing or invalid' });
        } else {
            for (const f of featureData.features) {
                const hKey = f.heuristic_key || 'unknown';
                
                if (seenKeys.has(hKey)) {
                    errors.push({ heuristic: hKey, field: 'heuristic_key', message: 'Duplicate key in run' });
                }
                seenKeys.add(hKey);

                if (f.games_activated > f.games_exposed) {
                    errors.push({ heuristic: hKey, field: 'games_activated', message: 'games_activated > games_exposed' });
                }

                // Check nested CIs
                if (f.search && f.search.node_growth_ci_lower !== null && f.search.node_growth_ci_upper !== null) {
                    if (f.search.node_growth_ci_lower > f.search.node_growth_ci_upper) {
                        errors.push({ heuristic: hKey, field: 'search.node_growth_ci_lower', message: 'CI lower exceeds upper' });
                    }
                }
            }
        }
        
        if (!manifest.engine_commit) {
            errors.push({ heuristic: 'global', field: 'engine_commit', message: 'Missing engine_commit in manifest' });
        }

        if (errors.length > 0) {
            runsRejected++;
            validationReports.push({ run_id, status: 'failed', errors });
        } else {
            runsValid++;
            
            for (const f of featureData.features) {
                const flattenedFeature = flattenObject(f);
                
                const combinedRow = {
                    run_id,
                    engine_commit: manifest.engine_commit,
                    analysis_version: manifest.analysis_version || "1.0.0",
                    validator_version: manifest.validator_version || "1.0.0",
                    feature_schema_version: manifest.feature_schema_version || featureData.schema_version,
                    timestamp: manifest.timestamp,
                    experiment_type: manifest.experiment_type || "unknown",
                    search_depth: manifest.search_depth,
                    experiment_games: manifest.games,
                    bootstrap_method: manifest.bootstrap_method || "percentile",
                    bootstrap_resamples: manifest.bootstrap_resamples || 1000,
                    bootstrap_seed: manifest.bootstrap_seed || 12345,
                    
                    ...flattenedFeature,
                    
                    measured_elo: sprtData ? sprtData.measured_elo : null,
                    elo_ci_low: sprtData ? sprtData.elo_ci_low : null,
                    elo_ci_high: sprtData ? sprtData.elo_ci_high : null,
                    llr: sprtData ? sprtData.llr : null,
                    llr_upper: sprtData ? sprtData.llr_upper : null,
                    llr_lower: sprtData ? sprtData.llr_lower : null,
                    sprt_status: sprtData ? sprtData.status : 'pending'
                };
                
                validFeatures.push(combinedRow);
                featureRows++;
            }
        }
    }
    
    fs.writeFileSync(VALIDATION_REPORT_PATH, JSON.stringify(validationReports, null, 2));
    
    const datasetManifest = {
        dataset_version: "1.1.0",
        generated_at: new Date().toISOString(),
        runs_scanned: runsScanned,
        runs_valid: runsValid,
        runs_rejected: runsRejected,
        feature_rows: featureRows,
        schema_versions: Array.from(schemaVersions)
    };
    fs.writeFileSync(DATASET_MANIFEST_PATH, JSON.stringify(datasetManifest, null, 2));

    if (validFeatures.length > 0) {
        const jsonlStr = validFeatures.map(f => JSON.stringify(f)).join('\n');
        fs.writeFileSync(JSONL_OUT, jsonlStr);
        
        // Guarantee consistent headers across runs by accumulating all seen keys
        const allKeys = new Set<string>();
        validFeatures.forEach(f => {
            Object.keys(f).forEach(k => allKeys.add(k));
        });
        
        const headers = Array.from(allKeys);
        const csvRows = validFeatures.map(f => {
            return headers.map(h => {
                const val = f[h];
                if (val === null || val === undefined) return '';
                if (typeof val === 'string') return `"${val}"`;
                return val;
            }).join(',');
        });
        fs.writeFileSync(CSV_OUT, [headers.join(','), ...csvRows].join('\n'));
    } else {
        fs.writeFileSync(JSONL_OUT, '');
        fs.writeFileSync(CSV_OUT, '');
    }
    
    console.log(`Dataset built successfully:`);
    console.log(`Valid Runs: ${runsValid}/${runsScanned}`);
    console.log(`Total Feature Rows: ${featureRows}`);
    console.log(`Outputs:`);
    console.log(` - ${JSONL_OUT}`);
    console.log(` - ${CSV_OUT}`);
    console.log(` - ${DATASET_MANIFEST_PATH}`);
    console.log(` - ${VALIDATION_REPORT_PATH}`);
}

run();
