#include "nnue.h"
#include <iostream>
#include <fstream>
#include <vector>
#include <cmath>
#include <algorithm>
#include "bitboard.h" // For pop_lsb

namespace NNUE {
    bool nnue_loaded = false;

    std::vector<float> ft_weights;
    std::vector<float> ft_biases;
    std::vector<float> l1_weights;
    std::vector<float> l1_biases;
    std::vector<float> l2_weights;
    std::vector<float> l2_biases;
    std::vector<float> out_weights;
    std::vector<float> out_biases;

    bool read_vector(std::ifstream& file, std::vector<float>& vec, size_t size) {
        vec.resize(size);
        file.read(reinterpret_cast<char*>(vec.data()), size * sizeof(float));
        return !file.fail();
    }

    bool is_loaded() {
        return nnue_loaded;
    }

    bool load(const std::string& filepath) {
        std::ifstream file(filepath, std::ios::binary);
        if (!file.is_open()) {
            nnue_loaded = false;
            return false;
        }

        uint32_t magic;
        file.read(reinterpret_cast<char*>(&magic), sizeof(uint32_t));
        if (magic != 0x790311E) {
            nnue_loaded = false;
            return false;
        }

        if (!read_vector(file, ft_weights, 4992 * 256)) return false;
        if (!read_vector(file, ft_biases, 256)) return false;
        if (!read_vector(file, l1_weights, 512 * 32)) return false;
        if (!read_vector(file, l1_biases, 32)) return false;
        if (!read_vector(file, l2_weights, 32 * 32)) return false;
        if (!read_vector(file, l2_biases, 32)) return false;
        if (!read_vector(file, out_weights, 32 * 1)) return false;
        if (!read_vector(file, out_biases, 1)) return false;

        nnue_loaded = true;
        return true;
    }

    int evaluate(const Board& b) {
        if (!nnue_loaded) return 0;

        std::vector<int> us_features;
        std::vector<int> them_features;
        
        int us_color = b.side_to_move;
        
        for (int c = WHITE; c <= BLACK; c++) {
            for (int pt = 0; pt < 39; pt++) {
                U64 bb = b.pieces[c][pt];
                while (bb) {
                    int sq = pop_lsb(bb);
                    int color_offset = (c == WHITE) ? 0 : 39 * 64;
                    int f_idx = color_offset + pt * 64 + sq;
                    
                    if (c == us_color) us_features.push_back(f_idx);
                    else them_features.push_back(f_idx);
                }
            }
        }
        
        std::vector<float> us_acc(256);
        std::vector<float> them_acc(256);
        
        for (int i = 0; i < 256; i++) {
            us_acc[i] = ft_biases[i];
            them_acc[i] = ft_biases[i];
        }
        
        for (int f : us_features) {
            for (int i = 0; i < 256; i++) {
                us_acc[i] += ft_weights[i * 4992 + f];
            }
        }
        for (int f : them_features) {
            for (int i = 0; i < 256; i++) {
                them_acc[i] += ft_weights[i * 4992 + f];
            }
        }
        
        std::vector<float> hidden(512);
        for (int i = 0; i < 256; i++) {
            hidden[i] = std::max(0.0f, std::min(1.0f, us_acc[i]));
            hidden[256 + i] = std::max(0.0f, std::min(1.0f, them_acc[i]));
        }
        
        std::vector<float> l1_acc(32);
        for (int i = 0; i < 32; i++) {
            l1_acc[i] = l1_biases[i];
            for (int j = 0; j < 512; j++) {
                l1_acc[i] += l1_weights[i * 512 + j] * hidden[j];
            }
        }
        
        std::vector<float> h1(32);
        for (int i = 0; i < 32; i++) {
            h1[i] = std::max(0.0f, std::min(1.0f, l1_acc[i]));
        }
        
        std::vector<float> l2_acc(32);
        for (int i = 0; i < 32; i++) {
            l2_acc[i] = l2_biases[i];
            for (int j = 0; j < 32; j++) {
                l2_acc[i] += l2_weights[i * 32 + j] * h1[j];
            }
        }
        
        std::vector<float> h2(32);
        for (int i = 0; i < 32; i++) {
            h2[i] = std::max(0.0f, std::min(1.0f, l2_acc[i]));
        }
        
        float out_acc = out_biases[0];
        for (int j = 0; j < 32; j++) {
            out_acc += out_weights[j] * h2[j];
        }
        
        // Output prediction 0.0 to 1.0 -> Convert to Centipawns (-30000 to +30000)
        // 0.5 is 0cp.
        int cp = static_cast<int>((out_acc - 0.5f) * 1000.0f);
        
        if (cp > 30000) cp = 30000;
        if (cp < -30000) cp = -30000;
        
        return cp;
    }
}
