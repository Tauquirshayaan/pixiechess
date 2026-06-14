# Pixie NNUE Training Guide

Now that the engine is perfectly integrated and handling ability states, you can train a real neural network to replace the dummy weights.

## Requirements
You must do this on a machine with a GPU (or Google Colab) with PyTorch installed.
- `pip install torch torchvision torchaudio`

## Steps

1. **Upload Data & Script**:
   Copy the `training_data.jsonl` and `nnue/train_nnue.py` scripts to your GPU machine.

2. **Run Training**:
   Run the training script on your GPU machine:
   ```bash
   python train_nnue.py --data training_data.jsonl --epochs 10
   ```
   *Note: Adjust epochs based on dataset size and time available.*

3. **Export Weights**:
   The script will automatically export a file named `pixiechess.nnue` once training concludes. This file will have the exact `0x790311E` magic header expected by your engine.

4. **Deploy**:
   Bring `pixiechess.nnue` back to your local environment and place it in the server bin directory, completely overwriting the dummy one:
   ```text
   g:\Pixiechessbot\pixiechess-server\src\engine\bin\pixiechess.nnue
   ```

5. **Restart Server**:
   Restart the Node.js `pixiechess-server`. The engine will now load the newly trained weights and use them in its Multi-PV search!
