#include "tt.h"

namespace TT {
    std::vector<TTEntry> table;
    size_t num_entries = 0;

    void init(size_t mb_size) {
        size_t bytes = mb_size * 1024 * 1024;
        num_entries = bytes / sizeof(TTEntry);
        table.resize(num_entries);
        clear();
    }

    void clear() {
        for (size_t i = 0; i < num_entries; i++) {
            table[i].hash = 0;
            table[i].depth = 0;
            table[i].score = 0;
            table[i].flag = 0;
            table[i].best_move = Move(0,0,0,0,0,0,0);
        }
    }

    void store(U64 hash, int depth, int score, int flag, Move best_move) {
        if (num_entries == 0) return;
        
        size_t index = hash % num_entries;
        
        // Replacement Scheme: Always replace (or replace if depth is greater/equal)
        // For Lazy SMP, 'always replace' often works fine as threads constantly overwrite
        if (table[index].hash == hash && table[index].depth > depth) {
            return; // Don't overwrite a deeper search of the exact same position
        }
        
        table[index].hash = hash;
        table[index].depth = depth;
        table[index].score = score;
        table[index].flag = flag;
        table[index].best_move = best_move;
    }

    bool probe(U64 hash, int depth, int alpha, int beta, int& return_score, Move& return_move) {
        if (num_entries == 0) return false;
        
        size_t index = hash % num_entries;
        
        if (table[index].hash == hash) {
            return_move = table[index].best_move;
            
            if (table[index].depth >= depth) {
                int score = table[index].score;
                int flag = table[index].flag;
                
                if (flag == TT_EXACT) {
                    return_score = score;
                    return true;
                }
                if (flag == TT_ALPHA && score <= alpha) {
                    return_score = alpha;
                    return true;
                }
                if (flag == TT_BETA && score >= beta) {
                    return_score = beta;
                    return true;
                }
            }
        }
        return false;
    }
}
