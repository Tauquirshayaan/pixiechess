import re
import os

with open(r"g:\Pixiechessbot\Stable Bot\pixie-engine-cpp\src\board.h", "r") as f:
    content = f.read()

# I know StateHistory size approximately
size_destroy = 12
state_history_size = 4 + 4 + 4 + 4 + 4 + 8 + (56 * 2) + 4 + (128 * 12) + 4 + (128 * 12) + 4 + (128 * 4) + (128 * 4)
print(f"Approx StateHistory size: {state_history_size} bytes")

board_size = (31 * 2 * 8) + (31 * 2 * 4) + (3 * 8) + 4 + 4 + 4 + 4 + 4 + 4 + 8 + 4 + 4 + 4 + 4 + 4 + (16 * 1) + (16 * 1) + (64 * 56) + (2048 * state_history_size)
print(f"Approx Board size: {board_size / (1024 * 1024)} MB")
