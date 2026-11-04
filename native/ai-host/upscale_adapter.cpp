#include "upscale_adapter.h"

#include "ort_adapter.h"

namespace adpai {

bool RunUpscaleTile(const std::wstring& model_path, bool use_directml,
                    const std::vector<uint8_t>& rgb, uint32_t width,
                    uint32_t height, int threads,
                    const std::atomic<bool>& cancel,
                    std::vector<uint8_t>& rgba, std::string& error) {
  if (width == 0 || height == 0 || width > 384 || height > 384) {
    error = "ai.bad_request";
    return false;
  }
  if (threads < 1 || threads > 4) {
    error = "ai.bad_request";
    return false;
  }
  return RunOnnxUpscale(model_path, use_directml, rgb, width, height, threads,
                        cancel, rgba, error);
}

}  // namespace adpai
