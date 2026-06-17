import torch
import json
import os
from model import PixieNNUE

def export_to_json(model_path='weights/nnue_raw.pth', output_path='weights/nnue_weights.json'):
    print(f"Loading weights from {model_path}...")
    model = PixieNNUE()
    
    if not os.path.exists(model_path):
        print(f"Error: {model_path} not found.")
        return
        
    model.load_state_dict(torch.load(model_path))
    model.eval()
    
    # Extract weights and biases
    weights = {}
    
    # Helper to convert tensor to flat list
    def to_list(tensor):
        return tensor.detach().cpu().numpy().flatten().tolist()
        
    for name, param in model.named_parameters():
        weights[name] = to_list(param)
        print(f"Exported {name} -> size {len(weights[name])}")
        
    print(f"Writing to {output_path}...")
    with open(output_path, 'w') as f:
        json.dump(weights, f)
        
    print("Done! Weights ready for TypeScript engine.")

if __name__ == '__main__':
    export_to_json()
