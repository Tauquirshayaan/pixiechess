@echo off
set "PATH=C:\Users\Shayaan\AppData\Local\Programs\Python\Python311\;C:\msys64\mingw64\bin;%PATH%"
set "EM_CONFIG=G:\Pixiechessbot\Stable Bot\emsdk\.emscripten"

echo Cleaning build_wasm directory...
rmdir /s /q build_wasm

echo Running emcmake...
python "G:\Pixiechessbot\Stable Bot\emsdk\upstream\emscripten\emcmake.py" cmake -G "MinGW Makefiles" -B build_wasm -S . -DEMSCRIPTEN=1

echo Building...
cmake --build build_wasm --config Release
