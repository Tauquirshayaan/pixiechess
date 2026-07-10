#include "see.h"
#include "evaluate.h"
#include "bitboard.h"
#include "rays.h"
#include "movegen.h"
#include <algorithm>

extern const int PIECE_VALUES[PIECE_TYPE_COUNT]; // Defined in evaluate.cpp

void apply_see_move(Board& b, int from_sq, int to_sq, int pt, Color c) {
    clear_bit(b.pieces[c][pt], from_sq);
    clear_bit(b.occupancies[c], from_sq);
    set_bit(b.pieces[c][pt], to_sq);
    set_bit(b.occupancies[c], to_sq);
    b.occupancies[BOTH] = b.occupancies[WHITE] | b.occupancies[BLACK];
}

int see(Board& b, Move m) {
    if (!m.is_capture()) return 0;
    if (m.captured() == IRONPAWN) return -PIECE_VALUES[m.piece()];

    int to_sq = m.to();
    int gain[32];
    int d = 0;
    
    // Initial capture value
    int victim_val = get_dynamic_piece_value(b, m.captured(), to_sq, (b.side_to_move == WHITE) ? BLACK : WHITE);
    gain[d] = victim_val;
    
    int current_attacker_sq = m.from();
    int current_attacker_pt = m.piece();
    Color current_attacker_color = b.side_to_move;
    
    // Anti-violence aura completely prevents capturing on this square!
    Color defender_color = (b.side_to_move == WHITE) ? BLACK : WHITE;
    if (b.pieces[defender_color][ANTI_VIOLENCE] & KING_ATTACKS[to_sq]) {
        return 0; // Captures are disabled here, SEE is technically 0 material gained since move fails
    }

    // Backup only the bitboards and limbo counters we modify (saves ~40KB of stack space vs full Board clone)
    U64 orig_pieces[2][PIECE_TYPE_COUNT];
    U64 orig_occupancies[3];
    int orig_num_km[2];
    
    int max_p = b.has_pixies() ? PIECE_TYPE_COUNT : 6;
    
    for (int c = 0; c < 2; c++) {
        for (int p = 0; p < max_p; p++) {
            orig_pieces[c][p] = b.pieces[c][p];
        }
        orig_num_km[c] = b.num_knightmares_limbo[c];
    }
    for (int i = 0; i < 3; i++) {
        orig_occupancies[i] = b.occupancies[i];
    }

    apply_see_move(b, current_attacker_sq, to_sq, current_attacker_pt, current_attacker_color);

    while (d < 31) {
        d++;
        // Now it's the other side's turn to recapture
        Color next_attacker_color = (current_attacker_color == WHITE) ? BLACK : WHITE;
        
        Board::AttackerInfo attacker = b.get_smallest_attacker(to_sq, next_attacker_color);
        if (attacker.piece_type == PIECE_TYPE_NONE) {
            d--; // No attacker found, rollback loop iteration
            break;
        }
        
        // The value gained by this recapture is the value of the piece currently standing on to_sq 
        // minus the value gained up to the previous step (minimax).
        int attacker_val = get_dynamic_piece_value(b, current_attacker_pt, current_attacker_sq, current_attacker_color);
        gain[d] = attacker_val - gain[d - 1];
        
        // Alpha-beta style pruning for SEE (if standing pat is better, break)
        if (std::max(-gain[d-1], gain[d]) < 0) break;
        
        // Apply the recapture to uncover X-ray defenders
        apply_see_move(b, attacker.sq, to_sq, attacker.piece_type, next_attacker_color);
        
        current_attacker_pt = attacker.piece_type;
        current_attacker_color = next_attacker_color;
        current_attacker_sq = attacker.sq;
    }

    while (d > 0) {
        gain[d - 1] = -std::max(-gain[d - 1], gain[d]);
        d--;
    }
    
    // Restore the board state
    for (int c = 0; c < 2; c++) {
        for (int p = 0; p < max_p; p++) {
            b.pieces[c][p] = orig_pieces[c][p];
        }
        b.num_knightmares_limbo[c] = orig_num_km[c];
    }
    for (int i = 0; i < 3; i++) {
        b.occupancies[i] = orig_occupancies[i];
    }
    
    return gain[0];
}
