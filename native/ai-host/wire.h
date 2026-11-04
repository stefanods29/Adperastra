#pragma once

#include <windows.h>

#include <cstdint>
#include <string>
#include <vector>

namespace adpai {

constexpr uint32_t kProtocolVersion = 1;
constexpr size_t kMaxHeaderBytes = 65536;
constexpr size_t kMaxPayload = 1024 * 1024;
constexpr size_t kOptionBytes = 75;

enum class FrameKind : uint8_t {
  kHeader = 1,
  kInputChunk = 2,
  kCancel = 4,
  kOutputChunk = 5,
  kProgress = 6,
  kResult = 7,
  kError = 8,
  kHeartbeat = 9,
};

struct Options {
  uint8_t task = 0;
  uint8_t scale = 0;
  uint8_t model = 0;
  uint8_t device = 0;
  uint32_t region[4] = {0, 0, 0, 0};
  uint32_t max_output_tokens = 0;
  uint64_t seed = 0;
  int32_t temperature_milli = 0;
  uint32_t threshold_milli = 500;
  uint8_t mask[16] = {};
  uint8_t embed_mode = 1;
  uint8_t translate_to_english = 0;
  uint64_t start_us = 0;
  uint64_t end_us = UINT64_MAX;
  uint8_t language = 0;
};

struct Header {
  uint8_t task = 0;
  uint8_t locale = 1;
  std::string model_id;
  std::string model_revision;
  uint64_t input_bytes = 0;
  uint32_t input_width = 0;
  uint32_t input_height = 0;
  uint32_t output_width = 0;
  uint32_t output_height = 0;
  Options options;
};

bool ReadExact(HANDLE handle, void* buffer, size_t length);
bool ReadFrame(HANDLE handle, FrameKind& kind, std::vector<uint8_t>& payload);
bool WriteFrame(HANDLE handle, FrameKind kind, const void* payload, size_t length);
bool ParseHeader(const std::vector<uint8_t>& bytes, Header& header);
std::string Sha256Hex(const uint8_t* data, size_t length);
bool IsSafeModelPath(const std::wstring& path);

}  // namespace adpai
