cmake_minimum_required(VERSION 3.15)
project(PixieEngine VERSION 1.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Check compiler and set AVX-512 / Optimization flags
if(EMSCRIPTEN)
    add_compile_options(-g)
elseif(MSVC)
    add_compile_options(/O2 /arch:AVX2 /fp:fast)
else()
    add_compile_options(-O3 -mavx2 -mbmi2 -ffast-math -flto)
endif()

# Recursively find all C++ source files in the src folder
file(GLOB_RECURSE SOURCES "src/*.cpp")

if(EMSCRIPTEN)
    # Exclude main.cpp from WASM build to prevent infinite loop
    list(REMOVE_ITEM SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp")
    # WASM Build
    add_executable(pixie-engine-wasm ${SOURCES})
    set_target_properties(pixie-engine-wasm PROPERTIES OUTPUT_NAME "pixie_engine")
    target_link_options(pixie-engine-wasm PRIVATE
        "-g"
        "-sEXPORTED_FUNCTIONS=['_init_engine','_get_legal_moves_json','_test_is_attacked','_test_ability_used','_test_pseudo_moves','_test_after_move']"
        "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME='createPixieEngine'"
        "-sALLOW_MEMORY_GROWTH=1"
    )
else()
    # Native Windows/Linux Build
    list(REMOVE_ITEM SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/src/wasm_bindings.cpp")
    add_executable(pixie-engine-cpp ${SOURCES})
    if(WIN32)
        target_link_options(pixie-engine-cpp PRIVATE -static -static-libgcc -static-libstdc++)
    endif()
endif()
