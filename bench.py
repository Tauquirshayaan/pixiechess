import subprocess
import time
import os

engine_path = r"g:\Pixiechessbot\Stable Bot\pixie-engine-cpp\build\pixie-engine-cpp.exe"

pfen_arr = ["-1"] * 64
pfen_arr[4] = "5" # White King e1
pfen_arr[60] = "105" # Black King e8
pfen_arr[8] = "0"; pfen_arr[9] = "0"; pfen_arr[10] = "0"
pfen_arr[53] = "100"; pfen_arr[54] = "100"; pfen_arr[55] = "100"

pfen_str = ",".join(pfen_arr)
# Format: 64 squares + side + castling + ep + dead_pieces + abilities + limbo
full_pfen = f"{pfen_str} w 0 -1 - - -;-"

commands = f"position pfen {full_pfen}\ngo movetime 3000\nquit\n"

process = subprocess.Popen([engine_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = process.communicate(input=commands)

print(stdout)
