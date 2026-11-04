// Step 17b: BiRefNet foreground adapter for AdperastraAiHost.
//
// The ONNX session itself belongs to 14c's `ort_adapter.cpp`; this file owns
// the model-specific tensor contract and the deterministic pre/post steps so
// the Rust side and the helper agree byte for byte (guide D2/D3).
//
// Graph contract produced by the coordinator's export wrapper:
//   input   "input"  float32 NCHW 1 x 3 x 1024 x 1024, RGB 0..1 normalized
//   output  "mask"   float32 N1HW 1 x 1 x 1024 x 1024, raw logits
// No other input or output name is accepted.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace adperastra::ai {

constexpr int kForegroundEdge = 1024;
constexpr const char* kForegroundInput = "input";
constexpr const char* kForegroundOutput = "mask";
constexpr float kMean[3] = {0.485f, 0.456f, 0.406f};
constexpr float kStd[3] = {0.229f, 0.224f, 0.225f};

inline float Bilinear(const float* plane, int src_w, int src_h, float x, float y) {
  if (src_w <= 0 || src_h <= 0) return 0.0f;
  const float sx = std::clamp(x, 0.0f, static_cast<float>(src_w - 1));
  const float sy = std::clamp(y, 0.0f, static_cast<float>(src_h - 1));
  const int x0 = static_cast<int>(std::floor(sx));
  const int y0 = static_cast<int>(std::floor(sy));
  const int x1 = std::min(x0 + 1, src_w - 1);
  const int y1 = std::min(y0 + 1, src_h - 1);
  const float fx = sx - static_cast<float>(x0);
  const float fy = sy - static_cast<float>(y0);
  const float top = plane[y0 * src_w + x0] + (plane[y0 * src_w + x1] - plane[y0 * src_w + x0]) * fx;
  const float bottom = plane[y1 * src_w + x0] + (plane[y1 * src_w + x1] - plane[y1 * src_w + x0]) * fx;
  return top + (bottom - top) * fy;
}

// RGBA -> normalized RGB NCHW. `out` holds 3 * 1024 * 1024 floats.
bool PreprocessForeground(const std::uint8_t* rgba, int width, int height, float* out) {
  if (rgba == nullptr || out == nullptr || width <= 0 || height <= 0) return false;
  // Stored RGB is sampled as-is; the original alpha is recomposed later.
  for (int channel = 0; channel < 3; ++channel) {
    float* plane = out + static_cast<std::size_t>(channel) * kForegroundEdge * kForegroundEdge;
    for (int y = 0; y < kForegroundEdge; ++y) {
      const float source_y = (static_cast<float>(y) + 0.5f) * static_cast<float>(height) / kForegroundEdge - 0.5f;
      for (int x = 0; x < kForegroundEdge; ++x) {
        const float source_x = (static_cast<float>(x) + 0.5f) * static_cast<float>(width) / kForegroundEdge - 0.5f;
        const int x0 = std::clamp(static_cast<int>(std::floor(source_x)), 0, width - 1);
        const int y0 = std::clamp(static_cast<int>(std::floor(source_y)), 0, height - 1);
        const int x1 = std::min(x0 + 1, width - 1);
        const int y1 = std::min(y0 + 1, height - 1);
        const float fx = std::clamp(source_x - static_cast<float>(x0), 0.0f, 1.0f);
        const float fy = std::clamp(source_y - static_cast<float>(y0), 0.0f, 1.0f);
        const auto sample = [&](int sx, int sy) {
          return static_cast<float>(rgba[(static_cast<std::size_t>(sy) * width + sx) * 4 + channel]) / 255.0f;
        };
        const float top = sample(x0, y0) + (sample(x1, y0) - sample(x0, y0)) * fx;
        const float bottom = sample(x0, y1) + (sample(x1, y1) - sample(x0, y1)) * fx;
        const float value = top + (bottom - top) * fy;
        plane[y * kForegroundEdge + x] = (value - kMean[channel]) / kStd[channel];
      }
    }
  }
  return true;
}

// Raw logits -> sigmoid -> bilinear resize to the source -> uint8 soft alpha.
bool PostprocessForeground(const float* logits, int width, int height, std::uint8_t* out_alpha) {
  if (logits == nullptr || out_alpha == nullptr || width <= 0 || height <= 0) return false;
  const float* plane = logits;
  for (int y = 0; y < height; ++y) {
    const float source_y = (static_cast<float>(y) + 0.5f) * kForegroundEdge / height - 0.5f;
    for (int x = 0; x < width; ++x) {
      const float source_x = (static_cast<float>(x) + 0.5f) * kForegroundEdge / width - 0.5f;
      const float logit = Bilinear(plane, kForegroundEdge, kForegroundEdge, source_x, source_y);
      const float probability = logit >= 0.0f ? 1.0f / (1.0f + std::exp(-std::min(logit, 60.0f)))
                                             : std::exp(std::max(logit, -60.0f)) /
                                                   (1.0f + std::exp(std::max(logit, -60.0f)));
      out_alpha[static_cast<std::size_t>(y) * width + x] =
          static_cast<std::uint8_t>(std::lround(std::clamp(probability, 0.0f, 1.0f) * 255.0f));
    }
  }
  return true;
}

// The binary selection other consumers use; the soft alpha is retained.
void ForegroundSelection(const std::uint8_t* alpha, std::size_t count, float threshold, std::uint8_t* out) {
  if (alpha == nullptr || out == nullptr) return;
  const float checked = (threshold >= 0.0f && threshold <= 1.0f) ? threshold : 0.5f;
  for (std::size_t index = 0; index < count; ++index) {
    out[index] = (static_cast<float>(alpha[index]) / 255.0f >= checked) ? 1u : 0u;
  }
}

}  // namespace adperastra::ai
