cd /g/Pixiechessbot/pixie-engine-cpp/build
./pixie-engine-cpp.exe <<EOF
uci
isready
ucinewgame
position startpos
go depth 4
quit
EOF
