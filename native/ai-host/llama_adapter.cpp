#include "llama_adapter.h"

namespace adpai {

bool RunLlamaText(const std::wstring& model_path, const std::string& prompt,
                  std::string& output, std::string& error) {
  (void)model_path;
  (void)prompt;
  output.clear();
  // Step 14c activates upscaling only. 17a installs the reviewed text/vision
  // provider and replaces this explicit unavailability with real calls to the
  // pinned llama.h / mtmd API. No template text is ever returned as a result.
  error = "ai.unsupported";
  return false;
}

}  // namespace adpai
