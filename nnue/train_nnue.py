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
  'ROCKETMAN', 'HORDELING'
]

# Map standard FEN characters to our indices
FEN_MAP = {
    'P': ('w', 'P'), 'N': ('w', 'N'), 'B': ('w', 'B'), 'R': ('w', 'R'), 'Q': ('w', 'Q'), 'K': ('w', 'K'),
    'p': ('b', 'P'), 'n': ('b', 'N'), 'b': ('b', 'B'), 'r': ('b', 'R'), 'q': ('b', 'Q'), 'k': ('b', 'K')
}

def get_piece_index(color, p_type, pixie_type=None):
    color_offset = 0 if color == 'w' else 39 * 64
    type_idx = -1
    if pixie_type and pixie_type in PIXIES:
        type_idx = 6 + PIXIES.index(pixie_type)
    elif p_type in PIECES:
        type_idx = PIECES.index(p_type)
        
    if type_idx == -1: return -1
    return color_offset + (type_idx * 64)

def parse_fen_to_tensors(fen, evaluation):
    us_tensor = torch.zeros(4992)
    them_tensor = torch.zeros(4992)
    
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
        board = obj['board']
        color = obj['color']
        score = obj['score']
        
        us_tensor = torch.zeros(4992)
        them_tensor = torch.zeros(4992)
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
                            
        # Convert local score (pawns) to centipawns to match Stockfish scale
        score_cp = score * 100.0
        target = max(0.0, min(1.0, 0.5 + (score_cp / 1000.0)))
        return us_tensor, them_tensor, torch.tensor([target], dtype=torch.float32)

    def __iter__(self):
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
                    
                # Yield 2 Stockfish samples to heavily enforce fundamental GM play
                for _ in range(2):
                    try:
                        hf_row = next(hf_iterator)
                        fen = hf_row.get('fen', '')
                        score = hf_row.get('cp', 0)
                        if score is None: 
                            mate_val = hf_row.get('mate', 0)
                            score = 10000 if mate_val > 0 else -10000 if mate_val < 0 else 0
                        elif type(score) is dict and 'cp' in score:
                            score = score['cp']
                        elif type(score) is not int and type(score) is not float:
                            score = 0
                        yield parse_fen_to_tensors(fen, score)
                    except StopIteration:
                        hf_iterator = iter(self.hf_stream)
                    except Exception as e:
                        pass

class HalfKP(nn.Module):
    def __init__(self):
        super(HalfKP, self).__init__()
        self.feature_transformer = nn.Linear(4992, 256) 
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
    # ── Device detection ──────────────────────────────────────────────────
    if torch.cuda.is_available():
        device = torch.device("cuda")
        print(f"🚀 CUDA GPU: {torch.cuda.get_device_name(0)}")
        BATCH_SIZE = 256
        NUM_WORKERS = 4
    else:
        device = torch.device("cpu")
        # Leave 2 cores free for Node.js web server and SSH
        NUM_CPUS = max(1, (os.cpu_count() or 8) - 2)
        print(f"🖥️  CPU mode: Using {NUM_CPUS} cores for training (leaving 2 free for live site)")
        # Use limited cores for PyTorch matrix operations (BLAS/OpenBLAS)
        torch.set_num_threads(NUM_CPUS)
        torch.set_num_interop_threads(NUM_CPUS)
        BATCH_SIZE = 128   # Larger than GPU default — RAM is not a bottleneck
        NUM_WORKERS = NUM_CPUS  # Match workers to allocated CPUs
    
    print(f"   Batch size: {BATCH_SIZE} | DataLoader workers: {NUM_WORKERS}")

    local_data = "training_data.jsonl"
    if not os.path.exists(local_data):
        local_data = "../pixiechess-server/training_data.jsonl"
    if not os.path.exists(local_data):
        local_data = "../pixie-engine-cpp/build/training_data.jsonl.gz"
    if not os.path.exists(local_data):
        local_data = "../pixie-engine-cpp/build/training_data.jsonl"
    if not os.path.exists(local_data):
        print(f"❌ Cannot find training_data.jsonl. Please copy it to the working directory.")
        return
    
    print(f"📂 Training data: {local_data}")
    dataset = HybridChessDataset(local_data)
    
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, num_workers=NUM_WORKERS, pin_memory=(device.type=="cuda"))
    
    model = HalfKP().to(device)
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.MSELoss()
    # No GradScaler needed for CPU training
    use_amp = device.type == "cuda"
    scaler = torch.cuda.amp.GradScaler() if use_amp else None
    
    epochs = 1
    print(f"🧠 Beginning Hybrid Training (HuggingFace Stockfish + Local PixieData)...")
    print(f"   Batch size: {dataloader.batch_size}, Device: {device}")
    for epoch in range(epochs):
        total_loss = 0
        batches = 0
        for us_f, them_f, target in dataloader:
            us_f, them_f, target = us_f.to(device), them_f.to(device), target.to(device)
            optimizer.zero_grad()
            
            if scaler and use_amp:
                # Mixed precision training for CUDA
                with torch.cuda.amp.autocast():
                    output = model(us_f, them_f)
                    loss = criterion(output, target)
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                output = model(us_f, them_f)
                loss = criterion(output, target)
                loss.backward()
                optimizer.step()
            
            total_loss += loss.item()
            batches += 1
            
            if batches % 100 == 0:
                print(f"   Batches: {batches:,} | Loss: {total_loss/batches:.4f}")
                
            if batches >= 5000:
                break
                
        print(f"✅ Training Complete! Final Average Loss: {total_loss/batches:.4f}")
    
    output_path = "pixiechess.nnue"
    export_nnue(model, output_path)
    print(f"✅ pixiechess.nnue exported to: {os.path.abspath(output_path)}")
    print(f"   File size: {os.path.getsize(output_path) / 1e6:.2f} MB")
    print(f"\nNext step: Copy this file to pixiechess-server/src/engine/bin/pixiechess.nnue and restart the server.")

if __name__ == "__main__":
    train()
