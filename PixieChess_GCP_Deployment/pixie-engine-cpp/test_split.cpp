#include <iostream>
#include <string>
#include <sstream>
#include <vector>

int main() {
    std::string pfen = "1,2,3 w 0 e3 - - -;-";
    std::stringstream ss(pfen);
    std::string token;
    
    std::getline(ss, token, ' ');
    std::cout << "1. Board: " << token << std::endl;
    
    std::getline(ss, token, ' ');
    std::cout << "2. Side: " << token << std::endl;
    
    std::getline(ss, token, ' ');
    std::cout << "3. Castling: " << token << std::endl;
    
    std::getline(ss, token, ' ');
    std::cout << "4. EP: " << token << std::endl;
    
    if (std::getline(ss, token, ' ')) {
        std::cout << "5. Dead: " << token << std::endl;
    }
    
    if (std::getline(ss, token, ' ')) {
        std::cout << "6. Abilities: " << token << std::endl;
    }
    
    if (std::getline(ss, token, ' ')) {
        std::cout << "7. Limbo: " << token << std::endl;
    }
    
    return 0;
}
