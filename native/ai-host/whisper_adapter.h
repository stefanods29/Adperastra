#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace adpai {

/// Speech is reserved for Step 17b. This build contains the pinned library but
/// registers no transcription capability.
bool RunWhisper(const std::wstring& model_path,
                const std::vector<float>& pcm_16khz_mono,
                std::string& transcript, std::string& error);

}  // namespace adpai
