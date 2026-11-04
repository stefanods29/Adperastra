#include "ort_adapter.h"

#include <onnxruntime_c_api.h>
#include <cpu_provider_factory.h>
#include <dml_provider_factory.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <memory>
#include <thread>

namespace adpai {
namespace {

struct ReleaseValue {
  const OrtApi* api;
  void operator()(OrtValue* value) const {
    if (value) api->ReleaseValue(value);
  }
};
struct ReleaseSession {
  const OrtApi* api;
  void operator()(OrtSession* value) const {
    if (value) api->ReleaseSession(value);
  }
};
struct ReleaseOptions {
  const OrtApi* api;
  void operator()(OrtSessionOptions* value) const {
    if (value) api->ReleaseSessionOptions(value);
  }
};
struct ReleaseMemoryInfo {
  const OrtApi* api;
  void operator()(OrtMemoryInfo* value) const {
    if (value) api->ReleaseMemoryInfo(value);
  }
};
struct ReleaseRunOptions {
  const OrtApi* api;
  void operator()(OrtRunOptions* value) const {
    if (value) api->ReleaseRunOptions(value);
  }
};
struct ReleaseEnv {
  const OrtApi* api;
  void operator()(OrtEnv* value) const {
    if (value) api->ReleaseEnv(value);
  }
};
struct FreeOrtName {
  OrtAllocator* allocator;
  void operator()(char* value) const {
    if (value) allocator->Free(allocator, value);
  }
};

bool BoundedProduct(uint64_t a, uint64_t b, uint64_t& out) {
  if (a == 0 || b == 0) return false;
  if (a > UINT64_MAX / b) return false;
  out = a * b;
  return true;
}

}  // namespace

bool RunOnnxUpscale(const std::wstring& model_path, bool use_directml,
                    const std::vector<uint8_t>& rgb, uint32_t width,
                    uint32_t height, int threads,
                    const std::atomic<bool>& cancel,
                    std::vector<uint8_t>& rgba, std::string& error) {
  error = "ai.failed";
  if (threads < 1 || threads > 4) {
    error = "ai.bad_request";
    return false;
  }
  if (rgb.size() != static_cast<size_t>(width) * height * 3) {
    error = "ai.bad_request";
    return false;
  }
  uint64_t pixels = 0;
  if (!BoundedProduct(width, height, pixels) || pixels > 384ull * 384ull) {
    error = "ai.memory_limit";
    return false;
  }
  const OrtApi* api = OrtGetApiBase()->GetApi(ORT_API_VERSION);
  if (!api) return false;

  OrtEnv* raw_env = nullptr;
  if (api->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "adperastra-ai-host", &raw_env) !=
      nullptr) {
    return false;
  }
  std::unique_ptr<OrtEnv, ReleaseEnv> env(raw_env, ReleaseEnv{api});

  OrtSessionOptions* raw_options = nullptr;
  if (api->CreateSessionOptions(&raw_options) != nullptr) return false;
  std::unique_ptr<OrtSessionOptions, ReleaseOptions> options(
      raw_options, ReleaseOptions{api});
  api->SetIntraOpNumThreads(options.get(), threads);
  api->SetSessionExecutionMode(options.get(), ORT_SEQUENTIAL);
  api->SetSessionGraphOptimizationLevel(options.get(),
                                        ORT_ENABLE_EXTENDED);
  if (use_directml) {
    // Memory patterns are disabled for DirectML; a failing GPU never falls
    // back silently inside the helper.
    api->DisableMemPattern(options.get());
    if (OrtSessionOptionsAppendExecutionProvider_DML(options.get(), 0) !=
        nullptr) {
      error = "ai.memory_limit";
      return false;
    }
  } else if (OrtSessionOptionsAppendExecutionProvider_CPU(options.get(), 1) !=
             nullptr) {
    return false;
  }

  OrtSession* raw_session = nullptr;
  if (api->CreateSession(env.get(), model_path.c_str(), options.get(),
                         &raw_session) != nullptr) {
    error = "ai.memory_limit";
    return false;
  }
  std::unique_ptr<OrtSession, ReleaseSession> session(raw_session,
                                                      ReleaseSession{api});

  OrtAllocator* allocator = nullptr;
  if (api->GetAllocatorWithDefaultOptions(&allocator) != nullptr) return false;
  size_t input_count = 0;
  size_t output_count = 0;
  if (api->SessionGetInputCount(session.get(), &input_count) != nullptr ||
      api->SessionGetOutputCount(session.get(), &output_count) != nullptr ||
      input_count != 1 || output_count != 1) {
    error = "ai.unsupported";
    return false;
  }
  char* input_name_raw = nullptr;
  char* output_name_raw = nullptr;
  if (api->SessionGetInputNameAllocated(session.get(), 0, allocator,
                                        &input_name_raw) != nullptr ||
      api->SessionGetOutputNameAllocated(session.get(), 0, allocator,
                                         &output_name_raw) != nullptr) {
    error = "ai.failed";
    return false;
  }
  std::unique_ptr<char, FreeOrtName> input_name(input_name_raw,
                                                FreeOrtName{allocator});
  std::unique_ptr<char, FreeOrtName> output_name(output_name_raw,
                                                 FreeOrtName{allocator});
  if (std::strcmp(input_name.get(), "input") != 0 ||
      std::strcmp(output_name.get(), "output") != 0) {
    error = "ai.unsupported";
    return false;
  }

  const int64_t shape[4] = {1, 3, static_cast<int64_t>(height),
                            static_cast<int64_t>(width)};
  std::vector<float> tensor(static_cast<size_t>(pixels) * 3);
  for (size_t index = 0; index < pixels; ++index) {
    tensor[index] = static_cast<float>(rgb[index * 3]) / 255.0f;
    tensor[pixels + index] = static_cast<float>(rgb[index * 3 + 1]) / 255.0f;
    tensor[pixels * 2 + index] = static_cast<float>(rgb[index * 3 + 2]) / 255.0f;
  }

  OrtMemoryInfo* raw_memory = nullptr;
  if (api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault,
                               &raw_memory) != nullptr) {
    return false;
  }
  std::unique_ptr<OrtMemoryInfo, ReleaseMemoryInfo> memory(
      raw_memory, ReleaseMemoryInfo{api});
  OrtValue* raw_input = nullptr;
  if (api->CreateTensorWithDataAsOrtValue(
          memory.get(), tensor.data(), tensor.size() * sizeof(float), shape, 4,
          ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &raw_input) != nullptr) {
    return false;
  }
  std::unique_ptr<OrtValue, ReleaseValue> input(raw_input, ReleaseValue{api});

  OrtRunOptions* raw_run = nullptr;
  if (api->CreateRunOptions(&raw_run) != nullptr) return false;
  std::unique_ptr<OrtRunOptions, ReleaseRunOptions> run_options(
      raw_run, ReleaseRunOptions{api});
  std::atomic<bool> finished{false};
  std::thread watchdog([&]() {
    while (!finished.load(std::memory_order_acquire)) {
      if (cancel.load(std::memory_order_acquire)) {
        api->RunOptionsSetTerminate(run_options.get());
        return;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
  });

  const char* input_names[1] = {input_name.get()};
  const char* output_names[1] = {output_name.get()};
  const OrtValue* input_values[1] = {input.get()};
  OrtValue* raw_output = nullptr;
  const OrtStatus* status =
      api->Run(session.get(), run_options.get(), input_names, input_values, 1,
               output_names, 1, &raw_output);
  const bool cancelled = cancel.load(std::memory_order_acquire);
  finished.store(true, std::memory_order_release);
  watchdog.join();
  if (status != nullptr) {
    api->ReleaseStatus(status);
    error = cancelled ? "ai.cancelled" : "ai.memory_limit";
    return false;
  }
  std::unique_ptr<OrtValue, ReleaseValue> output(raw_output, ReleaseValue{api});

  OrtTensorTypeAndShapeInfo* raw_info = nullptr;
  if (api->GetTensorTypeAndShape(output.get(), &raw_info) != nullptr) {
    return false;
  }
  size_t dimensions = 0;
  if (api->GetDimensionsCount(raw_info, &dimensions) != nullptr ||
      dimensions != 4) {
    api->ReleaseTensorTypeAndShapeInfo(raw_info);
    error = "ai.model_output";
    return false;
  }
  int64_t shape_out[4] = {};
  if (api->GetDimensions(raw_info, shape_out, 4) != nullptr) {
    api->ReleaseTensorTypeAndShapeInfo(raw_info);
    return false;
  }
  api->ReleaseTensorTypeAndShapeInfo(raw_info);
  if (shape_out[0] != 1 || shape_out[1] != 3 ||
      shape_out[2] != static_cast<int64_t>(height) * 4 ||
      shape_out[3] != static_cast<int64_t>(width) * 4) {
    error = "ai.model_output";
    return false;
  }
  void* raw_data = nullptr;
  if (api->GetTensorMutableData(output.get(), &raw_data) != nullptr) {
    return false;
  }
  auto* data = static_cast<float*>(raw_data);
  uint64_t output_pixels = 0;
  if (!BoundedProduct(static_cast<uint64_t>(width) * 4,
                      static_cast<uint64_t>(height) * 4, output_pixels) ||
      output_pixels > 384ull * 384ull * 16ull) {
    error = "ai.model_output";
    return false;
  }
  rgba.assign(static_cast<size_t>(output_pixels) * 4, 255);
  for (uint64_t index = 0; index < output_pixels; ++index) {
    for (int channel = 0; channel < 3; ++channel) {
      const float value = data[static_cast<size_t>(channel) * output_pixels + index];
      if (!std::isfinite(value)) {
        error = "ai.model_output";
        return false;
      }
      rgba[index * 4 + channel] =
          static_cast<uint8_t>(std::lround(std::clamp(value, 0.0f, 1.0f) * 255.0f));
    }
  }
  error.clear();
  return true;
}

}  // namespace adpai
