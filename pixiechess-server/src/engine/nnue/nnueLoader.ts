import * as fs from 'fs';
import * as path from 'path';

export const NUM_FEATURES = 4992;
export const ACCUMULATOR_SIZE = 256;
export const L1_SIZE = 32;
export const L2_SIZE = 32;

// The raw weight buffers (Float32Array for fast access)
export const nnueWeights = {
  ft_weight: new Float32Array(ACCUMULATOR_SIZE * NUM_FEATURES),
  ft_bias: new Float32Array(ACCUMULATOR_SIZE),
  l1_weight: new Float32Array(L1_SIZE * ACCUMULATOR_SIZE),
  l1_bias: new Float32Array(L1_SIZE),
  l2_weight: new Float32Array(L2_SIZE * L1_SIZE),
  l2_bias: new Float32Array(L2_SIZE),
  out_weight: new Float32Array(1 * L2_SIZE),
  out_bias: new Float32Array(1),
  isLoaded: false
};

/**
 * Loads the exported JSON weights from the Python training pipeline.
 */
export function loadNNUEWeights(weightsPath?: string) {
  if (nnueWeights.isLoaded) return;
  
  const targetPath = weightsPath || path.resolve(process.cwd(), 'scripts/weights/nnue_weights.json');
  if (!fs.existsSync(targetPath)) {
    console.warn(`[NNUE] Weights file not found at ${targetPath}. The NNUE evaluator will return 0.`);
    return;
  }

  try {
    const rawData = fs.readFileSync(targetPath, 'utf8');
    const data = JSON.parse(rawData);

    // Python exports parameters as: 'ft.weight', 'ft.bias', 'l1.weight', etc.
    nnueWeights.ft_weight.set(data['ft.weight']);
    nnueWeights.ft_bias.set(data['ft.bias']);
    
    nnueWeights.l1_weight.set(data['l1.weight']);
    nnueWeights.l1_bias.set(data['l1.bias']);
    
    nnueWeights.l2_weight.set(data['l2.weight']);
    nnueWeights.l2_bias.set(data['l2.bias']);
    
    nnueWeights.out_weight.set(data['out.weight']);
    nnueWeights.out_bias.set(data['out.bias']);
    
    nnueWeights.isLoaded = true;
    console.log('[NNUE] Successfully loaded neural network weights.');
  } catch (err) {
    console.error('[NNUE] Failed to load weights:', err);
  }
}
