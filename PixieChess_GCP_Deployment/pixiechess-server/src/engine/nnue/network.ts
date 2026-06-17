import { nnueWeights, ACCUMULATOR_SIZE, L1_SIZE, L2_SIZE } from './nnueLoader';

// Clipped ReLU activation function
function clippedReLU(x: number): number {
  return Math.max(0.0, Math.min(x, 1.0));
}

/**
 * Executes a fast forward pass of the neural network over the given Accumulator.
 * Returns a score between roughly -10.0 and 10.0.
 */
export function evaluateNNUE(accValues: Float32Array): number {
  if (!nnueWeights.isLoaded) return 0;

  // L1 Layer Pass
  const l1Out = new Float32Array(L1_SIZE);
  for (let i = 0; i < L1_SIZE; i++) {
    let sum = nnueWeights.l1_bias[i];
    const weightOffset = i * ACCUMULATOR_SIZE;
    for (let j = 0; j < ACCUMULATOR_SIZE; j++) {
      sum += nnueWeights.l1_weight[weightOffset + j] * clippedReLU(accValues[j]);
    }
    l1Out[i] = clippedReLU(sum);
  }

  // L2 Layer Pass
  const l2Out = new Float32Array(L2_SIZE);
  for (let i = 0; i < L2_SIZE; i++) {
    let sum = nnueWeights.l2_bias[i];
    const weightOffset = i * L1_SIZE;
    for (let j = 0; j < L1_SIZE; j++) {
      sum += nnueWeights.l2_weight[weightOffset + j] * l1Out[j];
    }
    l2Out[i] = clippedReLU(sum);
  }

  // Output Layer Pass
  let finalScore = nnueWeights.out_bias[0];
  for (let i = 0; i < L2_SIZE; i++) {
    finalScore += nnueWeights.out_weight[i] * l2Out[i];
  }

  // The final score is output as a raw real number. 
  // During training, we mapped [-10, 10] -> [0, 1].
  // Now we reverse that mapping to bring it back to centipawns or standard eval.
  // score = (norm * 2) - 1 => returns value between -1 and 1.
  // Multiply by 10 to get back to standard eval scale.
  return (finalScore * 2.0 - 1.0) * 10.0;
}
