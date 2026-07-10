#include "tt.h"

namespace TT {
    uint8_t current_age = 0;
    std::vector<TTEntry> table;
    size_t num_entries = 0;

    void init(size_t mb_size) {
        size_t bytes = mb_size * 1024 * 1024;
        num_entries = bytes / sizeof(TTEntry);
        table = std::vector<TTEntry>(num_entries); // Re-allocate since atomic is not copyable easily
        clear();
    }

    void clear() {
        for (size_t i = 0; i < num_entries; i++) {
            table[i].key.store(0, std::memory_order_relaxed);
            table[i].data.store(0, std::memory_order_relaxed);
        }
    }

    void store(U64 hash, int depth, int score, int flag, Move best_move) {
        if (num_entries == 0) return;
        
        size_t index = hash % num_entries;
        
        // Pack data into 64-bit unsigned int
        // Layout: [Move (32)] [Score (16)] [Depth (8)] [Age (6)] [Flag (2)]
        uint64_t data_payload = 0;
        data_payload |= (uint64_t)best_move.data << 32;
        data_payload |= (uint64_t)((uint16_t)score) << 16;
        data_payload |= (uint64_t)((uint8_t)depth) << 8;
        data_payload |= (uint64_t)(current_age & 0x3F) << 2;
        data_payload |= (uint64_t)(flag & 0x3);
        
        uint64_t old_data = table[index].data.load(std::memory_order_relaxed);
        uint64_t old_key = table[index].key.load(std::memory_order_relaxed);
        
        // Check if the old entry is valid and matches our hash
        if ((old_key ^ old_data) == hash) {
            uint8_t old_depth = (old_data >> 8) & 0xFF;
            uint8_t old_age = (old_data >> 2) & 0x3F;
            
            // Age-based Replacement Strategy
            // Don't overwrite if it's from the current generation AND its depth is greater.
            if (old_age == (current_age & 0x3F) && old_depth > depth) {
                return;
            }
        }
        
        // XOR lockless store
        table[index].data.store(data_payload, std::memory_order_relaxed);
        table[index].key.store(hash ^ data_payload, std::memory_order_relaxed);
    }

    bool probe(U64 hash, int depth, int alpha, int beta, int& return_score, Move& return_move) {
        if (num_entries == 0) return false;
        
        size_t index = hash % num_entries;
        
        uint64_t d = table[index].data.load(std::memory_order_relaxed);
        uint64_t k = table[index].key.load(std::memory_order_relaxed);
        
        // XOR check to prevent torn reads
        if ((k ^ d) == hash) {
            return_move.data = (uint32_t)(d >> 32);
            int entry_depth = (int)((d >> 8) & 0xFF);
            int score = (int16_t)((d >> 16) & 0xFFFF);
            int flag = (int)(d & 0x3);
            
            if (entry_depth >= depth) {
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
            // If depth is insufficient, we still got the best move, but we don't trigger a cutoff.
            return false;
        }
        return false;
    }
}
