#include <fcntl.h>
#include <io.h>
#include <windows.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "llama_adapter.h"
#include "upscale_adapter.h"
#include "whisper_adapter.h"
#include "wire.h"

namespace {

void SendError(HANDLE out, const char* code) {
  adpai::WriteFrame(out, adpai::FrameKind::kError, code,
                    std::strlen(code));
  std::fprintf(stderr, "ai-host: %s\n", code);
}

bool ParseDevice(const std::wstring& value, bool& gpu) {
  if (value == L"gpu") {
    gpu = true;
    return true;
  }
  if (value == L"cpu" || value == L"auto") {
    gpu = false;
    return true;
  }
  return false;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);

  std::wstring model_path;
  bool saw_host = false;
  bool saw_protocol = false;
  bool use_directml = false;
  int threads = 2;
  for (int index = 1; index < argc; ++index) {
    const std::wstring arg = argv[index];
    if (arg == L"--ai-host") {
      saw_host = true;
    } else if (arg == L"--protocol" && index + 1 < argc) {
      saw_protocol = std::wstring(argv[++index]) == L"1";
    } else if (arg == L"--model" && index + 1 < argc) {
      model_path = argv[++index];
    } else if (arg == L"--device" && index + 1 < argc) {
      if (!ParseDevice(argv[++index], use_directml)) return 2;
    } else if (arg == L"--threads" && index + 1 < argc) {
      const std::wstring value = argv[++index];
      if (value.size() != 1 || value[0] < L'1' || value[0] > L'4') return 2;
      threads = static_cast<int>(value[0] - L'0');
    } else {
      return 2;
    }
  }
  if (!saw_host || !saw_protocol || model_path.empty() ||
      !adpai::IsSafeModelPath(model_path)) {
    return 2;
  }

  const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  if (input == INVALID_HANDLE_VALUE || output == INVALID_HANDLE_VALUE) {
    return 2;
  }

  adpai::FrameKind kind = adpai::FrameKind::kError;
  std::vector<uint8_t> payload;
  if (!adpai::ReadFrame(input, kind, payload) ||
      kind != adpai::FrameKind::kHeader) {
    SendError(output, "ai.bad_request");
    return 0;
  }
  adpai::Header header;
  if (!adpai::ParseHeader(payload, header)) {
    SendError(output, "ai.bad_request");
    return 0;
  }
  if (header.task != 6) {
    // Text/vision/speech/embedding/mask providers are not registered by 14c.
    SendError(output, "ai.unsupported");
    return 0;
  }
  if (header.options.scale != 2 && header.options.scale != 4) {
    SendError(output, "ai.bad_request");
    return 0;
  }
  if (header.output_width != header.input_width * 4 ||
      header.output_height != header.input_height * 4) {
    SendError(output, "ai.bad_request");
    return 0;
  }

  std::vector<uint8_t> rgb;
  rgb.reserve(static_cast<size_t>(header.input_bytes));
  uint64_t remaining = header.input_bytes;
  while (remaining > 0) {
    if (!adpai::ReadFrame(input, kind, payload)) {
      SendError(output, "ai.failed");
      return 0;
    }
    if (kind == adpai::FrameKind::kCancel) {
      SendError(output, "ai.cancelled");
      return 0;
    }
    if (kind != adpai::FrameKind::kInputChunk || payload.empty() ||
        payload.size() > remaining) {
      SendError(output, "ai.bad_request");
      return 0;
    }
    rgb.insert(rgb.end(), payload.begin(), payload.end());
    remaining -= payload.size();
  }
  const uint64_t expected_input =
      static_cast<uint64_t>(header.input_width) * header.input_height * 3;
  if (rgb.size() != expected_input) {
    SendError(output, "ai.bad_request");
    return 0;
  }

  std::atomic<bool> cancel{false};
  std::thread cancel_reader([&]() {
    adpai::FrameKind next = adpai::FrameKind::kHeartbeat;
    std::vector<uint8_t> ignored;
    while (adpai::ReadFrame(input, next, ignored)) {
      if (next == adpai::FrameKind::kCancel) {
        cancel.store(true, std::memory_order_release);
        return;
      }
    }
  });

  std::vector<uint8_t> rgba;
  std::string error;
  const bool ok = adpai::RunUpscaleTile(
      model_path, use_directml, rgb, header.input_width, header.input_height,
      threads, cancel, rgba, error);
  cancel.store(true, std::memory_order_release);
  cancel_reader.detach();
  if (!ok) {
    SendError(output, error.empty() ? "ai.failed" : error.c_str());
    return 0;
  }

  const size_t chunk = adpai::kMaxPayload;
  for (size_t offset = 0; offset < rgba.size(); offset += chunk) {
    const size_t length = (std::min)(chunk, rgba.size() - offset);
    if (!adpai::WriteFrame(output, adpai::FrameKind::kOutputChunk,
                           rgba.data() + offset, length)) {
      SendError(output, "ai.failed");
      return 0;
    }
  }

  const std::string digest = adpai::Sha256Hex(rgba.data(), rgba.size());
  if (digest.size() != 64) {
    SendError(output, "ai.failed");
    return 0;
  }
  std::ostringstream json;
  json << "{\"model_id\":\"" << header.model_id
       << "\",\"model_revision\":\"" << header.model_revision
       << "\",\"output_width\":" << header.output_width
       << ",\"output_height\":" << header.output_height
       << ",\"output_sha256\":\"" << digest << "\",\"warnings\":[]}";
  const std::string text = json.str();
  if (!adpai::WriteFrame(output, adpai::FrameKind::kResult, text.data(),
                         text.size())) {
    return 0;
  }
  return 0;
}
