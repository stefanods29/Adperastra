#pragma once

#include <string>

namespace adpai {

/// Text/vision capability is reserved for Step 17a. The pinned llama.cpp code
/// is linked, but this build registers no text provider and never fabricates a
/// completion.
bool RunLlamaText(const std::wstring& model_path, const std::string& prompt,
                  std::string& output, std::string& error);

}  // namespace adpai
