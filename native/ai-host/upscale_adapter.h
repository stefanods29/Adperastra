#pragma once

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace adpai {

/// One 4x inference over a bounded RGB tile. Alpha is not passed to the model.
bool RunUpscaleTile(const std::wstring& model_path, bool use_directml,
                    const std::vector<uint8_t>& rgb, uint32_t width,
                    uint32_t height, int threads,
                    const std::atomic<bool>& cancel,
                    std::vector<uint8_t>& rgba, std::string& error);

}  // namespace adpai
