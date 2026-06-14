
#include "src/board.h"
#include <iostream>

int main() {
    init_ray_masks();
    Zobrist::init();
    Board b;
    b.init_from_pfen("-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,100,4,-1,130,-1,-1,-1,-1,4,-1,-1,-1,-1,5,-1,-1,-1,-1,-1,-1,-1,101,-1,-1,13,115,-1,-1,-1,101,-1,-1,108,-1,-1,-1,116,-1,-1,-1,-1,-1,21,4,-1,-1,-1,101,-1,-1,-1,105,1 b 0 64 - e_36_3");
    
    std::cout << "Electro charges at 36: " << b.ability_tracker[36].electro_charges << std::endl;
    Move m(36, 53, ELECTROKNIGHT, 21, PIECE_TYPE_NONE, true, false);
    std::cout << "In check before: " << b.in_check(BLACK) << std::endl;
    b.do_move(m);
    std::cout << "In check after: " << b.in_check(BLACK) << std::endl;
    std::cout << "White Queen at 54 bit: " << get_bit(b.pieces[WHITE][QUEEN], 54) << std::endl;
    std::cout << "Occupancies[BOTH] at 54: " << get_bit(b.occupancies[BOTH], 54) << std::endl;
    return 0;
}

