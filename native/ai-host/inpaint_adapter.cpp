// Step 17b: MI-GAN object-erase adapter for AdperastraAiHost.
//
// 14c's `ort_adapter.cpp` owns the ONNX session; this file owns the exact
// MI-GAN tensor contract and the final composite rules (guide D4):
//   image  "image" uint8 NCHW 1 x 3 x H x W
//   mask   "mask"  uint8 N1HW 1 x 1 x H x W, 0 = erase, 255 = keep
//   result "result" uint8 NCHW 1 x 3 x H x W
// The export wrapper normalizes these names and the input polarity.

#include <algorithm>
#include <cstddef>
#include <cstdint>

namespace adperastra::ai {

constexpr const char* kInpaintImageInput = "image";
constexpr const char* kInpaintMaskInput = "mask";
constexpr const char* kInpaintOutput = "result";
constexpr int kInpaintMaxEdge = 4096;
constexpr std::int64_t kInpaintMaxPixels = 16000000;

bool InpaintSizeAllowed(int width, int height) {
  if (width <= 0 || height <= 0) return false;
  if (width > kInpaintMaxEdge || height > kInpaintMaxEdge) return false;
  return static_cast<std::int64_t>(width) * static_cast<std::int64_t>(height) <= kInpaintMaxPixels;
}

// UI alpha >= 128 means "erase"; the graph receives 0 = erase, 255 = keep.
std::uint8_t InpaintMaskValueFromUiAlpha(std::uint8_t alpha) {
  return alpha >= 128 ? 0u : 255u;
}

// Splits RGBA into RGB NCHW plus the N1HW graph mask.
bool PrepareInpaint(const std::uint8_t* rgba, const std::uint8_t* ui_alpha, int width, int height,
                    std::uint8_t* out_rgb, std::uint8_t* out_mask) {
  if (!InpaintSizeAllowed(width, height)) return false;
  if (rgba == nullptr || ui_alpha == nullptr || out_rgb == nullptr || out_mask == nullptr) return false;
  const std::size_t pixels = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
  for (std::size_t index = 0; index < pixels; ++index) {
    for (int channel = 0; channel < 3; ++channel) {
      out_rgb[static_cast<std::size_t>(channel) * pixels + index] = rgba[index * 4 + channel];
    }
    out_mask[index] = InpaintMaskValueFromUiAlpha(ui_alpha[index]);
  }
  return true;
}

// Final image: outside the binary hole every source byte is copied exactly;
// inside it the generated RGB is used with the original alpha (D4).
bool ComposeInpaint(const std::uint8_t* original_rgba, const std::uint8_t* generated_rgb,
                    const std::uint8_t* ui_alpha, int width, int height, std::uint8_t* out_rgba) {
  if (!InpaintSizeAllowed(width, height)) return false;
  if (original_rgba == nullptr || generated_rgb == nullptr || ui_alpha == nullptr || out_rgba == nullptr) {
    return false;
  }
  const std::size_t pixels = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
  std::size_t erased = 0;
  for (std::size_t index = 0; index < pixels; ++index) {
    if (ui_alpha[index] >= 128) {
      ++erased;
    }
  }
  if (erased == 0) return false;                        // empty mask
  if (erased * 100 / pixels > 50) return false;         // image_mask_too_large
  for (std::size_t index = 0; index < pixels; ++index) {
    const bool erase = ui_alpha[index] >= 128;
    for (int channel = 0; channel < 3; ++channel) {
      out_rgba[index * 4 + channel] =
          erase ? generated_rgb[static_cast<std::size_t>(channel) * pixels + index]
                : original_rgba[index * 4 + channel];
    }
    out_rgba[index * 4 + 3] = original_rgba[index * 4 + 3];
  }
  return true;
}

}  // namespace adperastra::ai
