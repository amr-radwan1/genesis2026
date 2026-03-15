cmake_minimum_required(VERSION 3.14)
project(bitnet_jni C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# -- Source roots (populated by the build script) --
set(BITNET_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/bitnet_cpp")
set(LLAMA_ROOT  "${BITNET_ROOT}/3rdparty/llama.cpp")
set(GGML_ROOT   "${LLAMA_ROOT}/ggml")
set(BITNET_SRC  "${BITNET_ROOT}/src")
set(BITNET_INC  "${BITNET_ROOT}/include")

# -- BitNet flags (ARM NEON TL1 for Android ARM64) --
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
    add_compile_definitions(GGML_BITNET_ARM_TL1)
    set(GGML_BITNET_ARM_TL1 ON)
endif()

# Compiler flags
add_compile_options(-fpermissive -fPIC)

# -- ggml sources (CPU-only minimal set) --
set(GGML_SOURCES
    ${GGML_ROOT}/src/ggml.c
    ${GGML_ROOT}/src/ggml-alloc.c
    ${GGML_ROOT}/src/ggml-backend.cpp
    ${GGML_ROOT}/src/ggml-quants.c
    ${GGML_ROOT}/src/ggml-aarch64.c
)

# -- llama.cpp sources --
set(LLAMA_SOURCES
    ${LLAMA_ROOT}/src/llama.cpp
    ${LLAMA_ROOT}/src/llama-vocab.cpp
    ${LLAMA_ROOT}/src/llama-grammar.cpp
    ${LLAMA_ROOT}/src/llama-sampling.cpp
    ${LLAMA_ROOT}/src/unicode.cpp
    ${LLAMA_ROOT}/src/unicode-data.cpp
)

# -- BitNet kernel sources --
set(BITNET_SOURCES
    ${BITNET_SRC}/ggml-bitnet-lut.cpp
    ${BITNET_SRC}/ggml-bitnet-mad.cpp
)

# -- JNI wrapper --
set(JNI_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/bitnet_jni.cpp
)

# -- Build shared library --
add_library(bitnet_jni SHARED
    ${JNI_SOURCES}
    ${GGML_SOURCES}
    ${LLAMA_SOURCES}
    ${BITNET_SOURCES}
)

target_include_directories(bitnet_jni PRIVATE
    ${GGML_ROOT}/include
    ${GGML_ROOT}/src
    ${LLAMA_ROOT}/include
    ${LLAMA_ROOT}/src
    ${BITNET_INC}
)

target_link_libraries(bitnet_jni
    android
    log
)

# Disable GPU backends we don't need
target_compile_definitions(bitnet_jni PRIVATE
    GGML_USE_CPU
    _GNU_SOURCE
)
