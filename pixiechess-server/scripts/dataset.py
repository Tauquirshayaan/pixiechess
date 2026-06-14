import json
import torch
from torch.utils.data import Dataset, DataLoader
import numpy as np

PIECE_TYPES = [
    'P', 'N', 'B', 'R', 'Q', 'K',
    'GOLDEN_PAWN', 'IRONPAWN', 'BLUEPRINT', 'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WARP_JUMPER', 'WAR_AUTOMATON',
    'ELECTROKNIGHT', 'BANKER', 'CAMEL', 'KNIGHTMARE', 'ANTI_VIOLENCE', 'PINATA', 'FISH_KNIGHT', 'ARISTOCRAT', 'BASILISK',
    'BLADERUNNER', 'BOUNCER', 'PILGRIM', 'DANCER', 'DJINN', 'GUNSLINGER', 'CARDINAL', 'ICICLE', 'HORDE_MOTHER', 'MARAUDER',
    'PHASE_ROOK', 'SUMOROOK', 'FISSION_REACTOR', 'ROCKETMAN'
]

PIECE_TO_IDX = {pt: i for i, pt in enumerate(PIECE_TYPES)}
NUM_PIECE_TYPES = len(PIECE_TYPES)

def board_to_features(board, color_to_move):
    # Returns sparse indices and values for the feature vector
    # Feature index: (color * NUM_PIECE_TYPES * 64) + (piece_type * 64) + square
    # where color is 0 for my pieces, 1 for opponent pieces
    indices = []
    
    for r in range(8):
        for c in range(8):
            piece = board[r][c]
            if piece:
                is_mine = (piece['color'] == color_to_move)
                color_offset = 0 if is_mine else 1
                
                pt = piece.get('pixie')
                if not pt:
                    pt = piece['type']
                
                pt_idx = PIECE_TO_IDX.get(pt, 0) # Fallback to 0 if unknown
                square_idx = r * 8 + c
                
                feat_idx = (color_offset * NUM_PIECE_TYPES * 64) + (pt_idx * 64) + square_idx
                indices.append(feat_idx)
                
    return indices

class PixieChessDataset(Dataset):
    def __init__(self, jsonl_file, max_samples=None):
        self.indices_list = []
        self.scores = []
        self.results = []
        
        print(f"Loading dataset from {jsonl_file}...")
        with open(jsonl_file, 'r') as f:
            for i, line in enumerate(f):
                if max_samples and i >= max_samples:
                    break
                if not line.strip():
                    continue
                data = json.loads(line)
                board = data['b']
                color = data['c']
                score = data.get('s')
                if score is None:
                    score = 0.0
                result = data['r']
                
                indices = board_to_features(board, color)
                self.indices_list.append(indices)
                
                # Normalize score (e.g. clip between -10 and 10, then map to 0-1)
                norm_score = max(min(score, 10.0), -10.0) / 10.0
                norm_score = (norm_score + 1.0) / 2.0
                self.scores.append(norm_score)
                self.results.append(result)
                
                if i % 10000 == 0 and i > 0:
                    print(f"Loaded {i} positions...")
                    
        print(f"Loaded {len(self.indices_list)} positions in total.")

    def __len__(self):
        return len(self.indices_list)

    def __getitem__(self, idx):
        indices = self.indices_list[idx]
        score = self.scores[idx]
        result = self.results[idx]
        
        # Create a dense multi-hot vector for the input
        x = torch.zeros(NUM_PIECE_TYPES * 2 * 64, dtype=torch.float32)
        x[indices] = 1.0
        
        y = torch.tensor([result * 0.5 + score * 0.5], dtype=torch.float32)
        return x, y

if __name__ == '__main__':
    # Test dataset
    ds = PixieChessDataset('../training_data.jsonl', max_samples=10)
    if len(ds) > 0:
        x, y = ds[0]
        print("Input shape:", x.shape)
        print("Target shape:", y.shape)
        print("Active features:", x.sum().item())
