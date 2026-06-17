import torch
import torch.nn as nn

NUM_FEATURES = 4864 # 38 pieces * 2 colors * 64 squares
ACCUMULATOR_SIZE = 256
L1_SIZE = 32
L2_SIZE = 32

class ClippedReLU(nn.Module):
    def forward(self, x):
        return torch.clamp(x, 0.0, 1.0) # Standard for NNUE

class PixieNNUE(nn.Module):
    def __init__(self):
        super(PixieNNUE, self).__init__()
        
        # Accumulator layer
        self.ft = nn.Linear(NUM_FEATURES, ACCUMULATOR_SIZE)
        
        # Hidden layers
        self.l1 = nn.Linear(ACCUMULATOR_SIZE, L1_SIZE)
        self.l2 = nn.Linear(L1_SIZE, L2_SIZE)
        
        # Output layer
        self.out = nn.Linear(L2_SIZE, 1)
        
        self.crelu = ClippedReLU()

    def forward(self, x):
        # Accumulator pass
        acc = self.ft(x)
        acc = self.crelu(acc)
        
        # L1 pass
        l1 = self.l1(acc)
        l1 = self.crelu(l1)
        
        # L2 pass
        l2 = self.l2(l1)
        l2 = self.crelu(l2)
        
        # Output pass
        out = self.out(l2)
        return out
