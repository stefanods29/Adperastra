cmake_minimum_required(VERSION 3.25)
project(AdperastraAiHost VERSION 1.0.0 LANGUAGES C CXX)

# The coordinator retains and audits every dependency first. This build never
# downloads a source, model, tool or package.
set(ADPERASTRA_LLAMA_SOURCE_DIR "" CACHE PATH "Retained llama.cpp source at the pinned commit")
set(ADPERASTRA_WHISPER_SOURCE_DIR "" CACHE PATH "Retained whisper.cpp source at the pinned tag")
set(ADPERASTRA_ONNXRUNTIME_ROOT "" CACHE PATH "Retained ONNX Runtime 1.23.2 package root")
set(ADPERASTRA_ONNXRUNTIME_LIBRARY "" CACHE FILEPATH "onnxruntime.lib from the retained package")
if(NOT ADPERASTRA_LLAMA_SOURCE_DIR OR NOT EXISTS "${ADPERASTRA_LLAMA_SOURCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "ADPERASTRA_LLAMA_SOURCE_DIR must point at the pinned llama.cpp source")
endif()
if(NOT ADPERASTRA_WHISPER_SOURCE_DIR OR NOT EXISTS "${ADPERASTRA_WHISPER_SOURCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "ADPERASTRA_WHISPER_SOURCE_DIR must point at the pinned whisper.cpp source")
endif()
if(NOT ADPERASTRA_ONNXRUNTIME_ROOT OR NOT EXISTS "${ADPERASTRA_ONNXRUNTIME_ROOT}/include/onnxruntime_c_api.h")
  message(FATAL_ERROR "ADPERASTRA_ONNXRUNTIME_ROOT must contain the pinned ONNX Runtime headers")
endif()
if(NOT ADPERASTRA_ONNXRUNTIME_LIBRARY OR NOT EXISTS "${ADPERASTRA_ONNXRUNTIME_LIBRARY}")
  message(FATAL_ERROR "ADPERASTRA_ONNXRUNTIME_LIBRARY must point at the retained onnxruntime.lib")
endif()

set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)

add_subdirectory("${ADPERASTRA_LLAMA_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/llama.cpp" EXCLUDE_FROM_ALL)
if(NOT EXISTS "${ADPERASTRA_LLAMA_SOURCE_DIR}/tools/mtmd/CMakeLists.txt")
  message(FATAL_ERROR "the pinned llama.cpp source has no tools/mtmd library")
endif()
if(NOT TARGET mtmd)
  add_subdirectory("${ADPERASTRA_LLAMA_SOURCE_DIR}/tools/mtmd"
    "${CMAKE_BINARY_DIR}/llama-mtmd" EXCLUDE_FROM_ALL)
endif()
add_subdirectory("${ADPERASTRA_WHISPER_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/whisper.cpp" EXCLUDE_FROM_ALL)

add_executable(AdperastraAiHost
  main.cpp
  wire.cpp
  llama_adapter.cpp
  ort_adapter.cpp
  whisper_adapter.cpp
  upscale_adapter.cpp
  foreground_adapter.cpp
  inpaint_adapter.cpp
)

target_compile_features(AdperastraAiHost PRIVATE cxx_std_20)
target_include_directories(AdperastraAiHost PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${ADPERASTRA_ONNXRUNTIME_ROOT}/include"
  "${ADPERASTRA_WHISPER_SOURCE_DIR}/include"
  "${ADPERASTRA_LLAMA_SOURCE_DIR}/include"
  "${ADPERASTRA_LLAMA_SOURCE_DIR}/tools/mtmd"
)

target_link_libraries(AdperastraAiHost PRIVATE
  llama
  mtmd
  whisper
  "${ADPERASTRA_ONNXRUNTIME_LIBRARY}"
  bcrypt
)

target_compile_definitions(AdperastraAiHost PRIVATE
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
  ADPERASTRA_AI_HOST_VERSION="1.0.0"
  ADPERASTRA_AI_PROTOCOL_VERSION=1
)

if(MSVC)
  target_compile_options(AdperastraAiHost PRIVATE
    /W4 /WX /permissive- /EHsc /guard:cf /GS /sdl
    /D_CRT_SECURE_NO_WARNINGS
  )
  target_link_options(AdperastraAiHost PRIVATE
    /DYNAMICBASE /NXCOMPAT /guard:cf /HIGHENTROPYVA
  )
else()
  target_compile_options(AdperastraAiHost PRIVATE -Wall -Wextra -Werror)
endif()

set_target_properties(AdperastraAiHost PROPERTIES
  OUTPUT_NAME "AdperastraAiHost"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  PDB_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/symbols"
)

# The pack builder copies the exact runtime DLL set and hashes it. No install
# rule writes into the user's folders.
install(TARGETS AdperastraAiHost RUNTIME DESTINATION .)
