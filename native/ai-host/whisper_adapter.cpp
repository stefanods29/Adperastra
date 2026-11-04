#include "whisper_adapter.h"

namespace adpai {

bool RunWhisper(const std::wstring& model_path,
                const std::vector<float>& pcm_16khz_mono,
                std::string& transcript, std::string& error) {
  (void)model_path;
  (void)pcm_16khz_mono;
  transcript.clear();
  // 17b registers speech after the microphone/speech consent contract exists.
  error = "ai.unsupported";
  return false;
}

}  // namespace adpai
