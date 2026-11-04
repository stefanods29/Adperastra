#pragma once

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace adpai {

/// Runs one 4x tile through the pinned float32 Real-ESRGAN ONNX model.
/// `rgb` is row-major RGB8 at width x height; `rgba` receives 4x RGBA8.
/// Only catalog tensor names `input`/`output` are accepted.
bool RunOnnxUpscale(const std::wstring& model_path, bool use_directml,
                    const std::vector<uint8_t>& rgb, uint32_t width,
                    uint32_t height, int threads,
                    const std::atomic<bool>& cancel,
                    std::vector<uint8_t>& rgba, std::string& error);

}  // namespace adpai
