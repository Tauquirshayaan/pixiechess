#include <iostream>
#include <string>
#include "src/board.h"
#include "src/movegen.h"
#include "src/zobrist.h"

int main() {
    Zobrist::init();
    Board b;
    // White king at d2 (TS: r=6, c=3) -> C++: r=1, c=3 -> 11
    // Black Knightmare at b0 (TS: r=8, c=1) -> C++: r=-1, c=1
    // encoded = (-1+2)<<4 | (1+2) = 19
    // PFEN string: (64 squares), side, castling, ep, dead, abilities, limbo
    std::string pfen = "-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,1,-,-,-,-,-,-,-,-,-,-,- w 0 - - - -;19";
    b.init_from_pfen(pfen);
    
    bool in_check = b.is_square_attacked(11, BLACK); // 11 is d2
    std::cout << "White King at d2 attacked by Black Limbo? " << (in_check ? "YES" : "NO") << std::endl;
    return 0;
}
