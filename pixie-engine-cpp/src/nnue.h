#ifndef NNUE_H
#define NNUE_H

#include "board.h"
#include <string>

namespace NNUE {
    bool is_loaded();
    bool load(const std::string& filepath);
    int evaluate(const Board& b);
}

#endif
