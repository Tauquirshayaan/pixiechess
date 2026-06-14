import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import os
import sys

from dataset import PixieChessDataset
from model import PixieNNUE

# Force PyTorch to use all 8 vCPUs optimally
torch.set_num_threads(8)

def train(epochs=10, batch_size=1024, lr=0.001):
    print("Initializing PyTorch Training on CPU (8 Threads)...")
    
    # Check if dataset exists
    data_path = '../training_data.jsonl'
    if not os.path.exists(data_path) or os.path.getsize(data_path) == 0:
        print(f"Error: {data_path} is empty or missing.")
        print("Please run `npm run generate-data` to generate training data first!")
        sys.exit(1)

    dataset = PixieChessDataset(data_path)
    if len(dataset) < 100:
        print("Warning: Dataset is very small. Training will overfit heavily.")

    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    
    model = PixieNNUE()
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)
    
    print(f"Starting training for {epochs} epochs...")
    
    for epoch in range(epochs):
        model.train()
        running_loss = 0.0
        
        for i, (inputs, targets) in enumerate(dataloader):
            optimizer.zero_grad()
            
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            
            loss.backward()
            optimizer.step()
            
            running_loss += loss.item()
            
            if (i + 1) % 10 == 0:
                print(f"Epoch {epoch+1}/{epochs}, Batch {i+1}/{len(dataloader)}, Loss: {running_loss / 10:.4f}")
                running_loss = 0.0
                
    print("Training Complete!")
    os.makedirs('weights', exist_ok=True)
    torch.save(model.state_dict(), 'weights/nnue_raw.pth')
    print("Saved model weights to weights/nnue_raw.pth")

if __name__ == '__main__':
    train()
