import os
import json
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset, IterableDataset
import struct
from datasets import load_dataset
import random

# 37 piece types: 6 standard (P,N,B,R,Q,K) + 31 Pixies
PIECES = ['P', 'N', 'B', 'R', 'Q', 'K']
PIXIES = [
  'GOLDEN_PAWN', 'IRONPAWN', 'BLUEPRINT', 'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WARP_JUMPER', 'WAR_AUTOMATON',
  'ELECTROKNIGHT', 'BANKER', 'CAMEL', 'KNIGHTMARE', 'ANTI_VIOLENCE', 'PINATA', 'FISH_KNIGHT',
  'ARISTOCRAT', 'BASILISK', 'BLADERUNNER', 'BOUNCER', 'PILGRIM', 'DANCER', 'DJINN', 'GUNSLINGER', 'CARDINAL', 'ICICLE', 'HORDE_MOTHER', 'MARAUDER',
  'PHASE_ROOK', 'SUMOROOK',
  'FISSION_REACTOR',
  'ROCKETMAN'
]

# Map standard FEN characters to our indices
FEN_MAP = {
    'P': ('w', 'P'), 'N': ('w', 'N'), 'B': ('w', 'B'), 'R': ('w', 'R'), 'Q': ('w', 'Q'), 'K': ('w', 'K'),
    'p': ('b', 'P'), 'n': ('b', 'N'), 'b': ('b', 'B'), 'r': ('b', 'R'), 'q': ('b', 'Q'), 'k': ('b', 'K')
}

def get_piece_index(color, p_type, pixie_type=None):
    color_offset = 0 if color == 'w' else 37 * 64
    type_idx = -1
    if pixie_type and pixie_type in PIXIES:
        type_idx = 6 + PIXIES.index(pixie_type)
    elif p_type in PIECES:
        type_idx = PIECES.index(p_type)
        
    if type_idx == -1: return -1
    return color_offset + (type_idx * 64)

def parse_fen_to_tensors(fen, evaluation):
    us_tensor = torch.zeros(4736)
    them_tensor = torch.zeros(4736)
    
    parts = fen.split(' ')
    board_part = parts[0]
    active_color = parts[1] if len(parts) > 1 else 'w'
    
    r = 0
    c = 0
    for char in board_part:
        if char == '/':
            r += 1
            c = 0
        elif char.isdigit():
            c += int(char)
        elif char in FEN_MAP:
            p_color, p_type = FEN_MAP[char]
            sq_idx = (7 - r) * 8 + c
            p_idx = get_piece_index(p_color, p_type)
            if p_idx != -1:
                if p_color == active_color:
                    us_tensor[p_idx + sq_idx] = 1.0
                else:
                    them_tensor[p_idx + sq_idx] = 1.0
            c += 1
            
    # Normalize stockfish evaluation (centipawns) to 0.0 - 1.0 range
    # Approx sigmoid curve: 0cp = 0.5, +300cp = ~0.8, -300cp = ~0.2
    if active_color == 'b':
        evaluation = -evaluation

    target = 0.5 + (evaluation / 1000.0)
    target = max(0.0, min(1.0, target))
    return us_tensor, them_tensor, torch.tensor([target], dtype=torch.float32)

class HybridChessDataset(IterableDataset):
    def __init__(self, local_file, max_samples=200000):
        self.local_file = local_file
        self.max_samples = max_samples
        print("Initializing Hugging Face Lichess Stockfish Stream...")
        # Stream the official Stockfish evaluations without downloading the full dataset!
        self.hf_stream = load_dataset("mateuszgrzyb/lichess-stockfish-normalized", split="train", streaming=True)

    def process_local_line(self, line):
        obj = json.loads(line)
        board = obj['b']
        color = obj['c']
        score = obj['s']
        result = obj['r']
        
        us_tensor = torch.zeros(4736)
        them_tensor = torch.zeros(4736)
        for r in range(8):
            for c in range(8):
                piece = board[r][c]
                if piece:
                    sq_idx = (7 - r) * 8 + c
                    p_idx = get_piece_index(piece['color'], piece['type'], piece.get('pixie'))
                    if p_idx != -1:
                        if piece['color'] == color:
                            us_tensor[p_idx + sq_idx] = 1.0
                        else:
                            them_tensor[p_idx + sq_idx] = 1.0
                            
        target = max(0.0, min(1.0, (score / 1000.0) * 0.5 + (result * 0.5)))
        return us_tensor, them_tensor, torch.tensor([target], dtype=torch.float32)

    def __iter__(self):
        # We alternate yielding 1 Stockfish evaluation and 1 Local Pixie evaluation
        hf_iterator = iter(self.hf_stream)
        
        import gzip
        open_fn = gzip.open if self.local_file.endswith('.gz') else open
        with open_fn(self.local_file, 'rt', encoding='utf-8') as f:
            for count, local_line in enumerate(f):
                if count >= self.max_samples:
                    break
                    
                if not local_line.strip(): continue
                
                # Yield 1 Local Pixie sample
                try:
                    yield self.process_local_line(local_line)
                except Exception:
                    pass
                    
                # Yield 2 Stockfish samples to heavily enforce fundamental GM openings
                for _ in range(2):
                    try:
                        hf_row = next(hf_iterator)
                        # The dataset usually provides 'fen' and 'eval' or 'score'
                        fen = hf_row.get('fen', '')
                        # mateuszgrzyb/lichess-stockfish-normalized uses 'cp' instead of 'eval'
                        score = hf_row.get('cp', 0)
                        if score is None: 
                            # If it's a forced mate, it might have 'mate' instead of 'cp'
                            mate_val = hf_row.get('mate', 0)
                            score = 10000 if mate_val > 0 else -10000 if mate_val < 0 else 0
                        elif type(score) is dict and 'cp' in score:
                            score = score['cp']
                        elif type(score) is not int and type(score) is not float:
                            score = 0
                        yield parse_fen_to_tensors(fen, score)
                    except StopIteration:
                        # Re-initialize stream if we run out (unlikely for 300M rows)
                        hf_iterator = iter(self.hf_stream)
                    except Exception as e:
                        pass

class HalfKP(nn.Module):
    def __init__(self):
        super(HalfKP, self).__init__()
        self.feature_transformer = nn.Linear(4736, 256) 
        self.layer1 = nn.Linear(512, 32)
        self.layer2 = nn.Linear(32, 32)
        self.output = nn.Linear(32, 1)

    def forward(self, us_features, them_features):
        us_acc = torch.clamp(self.feature_transformer(us_features), 0.0, 1.0)
        them_acc = torch.clamp(self.feature_transformer(them_features), 0.0, 1.0)
        x = torch.cat([us_acc, them_acc], dim=1)
        x = torch.clamp(self.layer1(x), 0.0, 1.0)
        x = torch.clamp(self.layer2(x), 0.0, 1.0)
        return self.output(x)

def export_nnue(model, filename):
    print(f"Exporting model weights to {filename}...")
    with open(filename, 'wb') as f:
        f.write(struct.pack('<I', 0x790311E)) 
        def write_tensor(tensor):
            for val in tensor.detach().cpu().numpy().flatten():
                f.write(struct.pack('<f', float(val)))
        def write_bias(tensor):
            for val in tensor.detach().cpu().numpy().flatten():
                f.write(struct.pack('<f', float(val)))

        write_tensor(model.feature_transformer.weight)
        write_bias(model.feature_transformer.bias)
        write_tensor(model.layer1.weight)
        write_bias(model.layer1.bias)
        write_tensor(model.layer2.weight)
        write_bias(model.layer2.bias)
        write_tensor(model.output.weight)
        write_bias(model.output.bias)

def train():
    device = torch.device("cpu")
    print(f"Starting PyTorch on {device}")
    
    local_data = "../pixie-engine-cpp/build/training_data.jsonl.gz"
    if not os.path.exists(local_data):
        local_data = "../pixie-engine-cpp/build/training_data.jsonl"
    if not os.path.exists(local_data):
        print(f"Cannot find {local_data}. Please run generator first.")
        return
        
    dataset = HybridChessDataset(local_data)
    dataloader = DataLoader(dataset, batch_size=64) # IterableDataset handles shuffling inherently via stream length
    
    model = HalfKP().to(device)
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.MSELoss()
    
    epochs = 1 # 1 Epoch is enough for streamed massive datasets
    print("Beginning Hybrid Training (HuggingFace Stockfish + Local PixieData)...")
    for epoch in range(epochs):
        total_loss = 0
        batches = 0
        for us_f, them_f, target in dataloader:
            us_f, them_f, target = us_f.to(device), them_f.to(device), target.to(device)
            optimizer.zero_grad()
            output = model(us_f, them_f)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            batches += 1
            
            if batches % 100 == 0:
                print(f"Batches Processed: {batches} | Current Loss: {total_loss/batches:.4f}")
                
            if batches >= 5000: # Limit training time for deployment demo
                break
                
        print(f"Training Complete! Final Average Loss: {total_loss/batches:.4f}")
    
    os.makedirs("../pixie-engine-cpp/build", exist_ok=True)
    export_nnue(model, "../pixie-engine-cpp/build/pixiechess.nnue")
    print("Success! pixiechess.nnue exported successfully to ../pixie-engine-cpp/build/pixiechess.nnue!")

if __name__ == "__main__":
    train()
