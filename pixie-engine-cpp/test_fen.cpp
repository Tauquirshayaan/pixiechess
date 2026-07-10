#include <iostream>
#include <string>

int main() {
    int cppR = 9;
    int cppC = 3;
    uint8_t encoded = ((cppR + 2) << 4) | (cppC + 2);
    
    int ob_r = (encoded >> 4) - 2;
    int ob_c = (encoded & 0xF) - 2;
    std::cout << "R: " << ob_r << " C: " << ob_c << std::endl;
    return 0;
}
