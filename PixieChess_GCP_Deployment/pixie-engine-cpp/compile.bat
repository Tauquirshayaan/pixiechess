@echo off
set PATH=C:\msys64\mingw64\bin;%PATH%
rmdir /s /q build
cmake -G "MinGW Makefiles" -B build -S .
cmake --build build --config Release
