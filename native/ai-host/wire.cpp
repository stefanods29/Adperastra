#include "wire.h"

#include <bcrypt.h>

#include <cstring>

#pragma comment(lib, "bcrypt.lib")

namespace adpai {
namespace {

constexpr uint8_t kMagic[8] = {'A', 'D', 'P', 'A', 'I', 'H', '0', '1'};

uint16_t ReadU16(const std::vector<uint8_t>& bytes, size_t& cursor) {
  if (cursor + 2 > bytes.size()) return 0xffff;
  const uint16_t value =
      static_cast<uint16_t>(bytes[cursor]) |
      static_cast<uint16_t>(bytes[cursor + 1]) << 8;
  cursor += 2;
  return value;
}

uint32_t ReadU32(const std::vector<uint8_t>& bytes, size_t& cursor) {
  if (cursor + 4 > bytes.size()) return 0xffffffffu;
  uint32_t value = 0;
  for (int index = 0; index < 4; ++index) {
    value |= static_cast<uint32_t>(bytes[cursor + index]) << (8 * index);
  }
  cursor += 4;
  return value;
}

uint64_t ReadU64(const std::vector<uint8_t>& bytes, size_t& cursor) {
  if (cursor + 8 > bytes.size()) return 0xffffffffffffffffull;
  uint64_t value = 0;
  for (int index = 0; index < 8; ++index) {
    value |= static_cast<uint64_t>(bytes[cursor + index]) << (8 * index);
  }
  cursor += 8;
  return value;
}

bool ReadString(const std::vector<uint8_t>& bytes, size_t& cursor,
                std::string& out) {
  const uint16_t length = ReadU16(bytes, cursor);
  if (length == 0xffff || length == 0 || cursor + length > bytes.size()) {
    return false;
  }
  out.assign(reinterpret_cast<const char*>(bytes.data() + cursor), length);
  cursor += length;
  return true;
}

bool AllAscii(const std::string& value) {
  for (unsigned char unit : value) {
    if (unit < 0x20 || unit > 0x7e) return false;
  }
  return true;
}

}  // namespace

bool ReadExact(HANDLE handle, void* buffer, size_t length) {
  auto* cursor = static_cast<uint8_t*>(buffer);
  size_t remaining = length;
  while (remaining > 0) {
    DWORD read = 0;
    if (!ReadFile(handle, cursor, static_cast<DWORD>(remaining), &read, nullptr) ||
        read == 0) {
      return false;
    }
    cursor += read;
    remaining -= read;
  }
  return true;
}

bool ReadFrame(HANDLE handle, FrameKind& kind, std::vector<uint8_t>& payload) {
  uint8_t prefix[5] = {};
  if (!ReadExact(handle, prefix, sizeof(prefix))) return false;
  const uint8_t tag = prefix[0];
  if (tag != 1 && tag != 2 && tag != 4 && tag != 5 && tag != 6 && tag != 7 &&
      tag != 8 && tag != 9) {
    return false;
  }
  const uint32_t length = static_cast<uint32_t>(prefix[1]) |
                          static_cast<uint32_t>(prefix[2]) << 8 |
                          static_cast<uint32_t>(prefix[3]) << 16 |
                          static_cast<uint32_t>(prefix[4]) << 24;
  if (length > kMaxPayload) return false;
  payload.assign(length, 0);
  if (length > 0 && !ReadExact(handle, payload.data(), length)) return false;
  kind = static_cast<FrameKind>(tag);
  return true;
}

bool WriteFrame(HANDLE handle, FrameKind kind, const void* payload,
                size_t length) {
  if (length > kMaxPayload) return false;
  uint8_t prefix[5] = {static_cast<uint8_t>(kind),
                       static_cast<uint8_t>(length & 0xff),
                       static_cast<uint8_t>((length >> 8) & 0xff),
                       static_cast<uint8_t>((length >> 16) & 0xff),
                       static_cast<uint8_t>((length >> 24) & 0xff)};
  DWORD written = 0;
  if (!WriteFile(handle, prefix, sizeof(prefix), &written, nullptr) ||
      written != sizeof(prefix)) {
    return false;
  }
  const auto* cursor = static_cast<const uint8_t*>(payload);
  size_t remaining = length;
  while (remaining > 0) {
    if (!WriteFile(handle, cursor, static_cast<DWORD>(remaining), &written,
                   nullptr) ||
        written == 0) {
      return false;
    }
    cursor += written;
    remaining -= written;
  }
  return true;
}

bool ParseHeader(const std::vector<uint8_t>& bytes, Header& header) {
  if (bytes.size() < 64 || bytes.size() > kMaxHeaderBytes ||
      std::memcmp(bytes.data(), kMagic, sizeof(kMagic)) != 0) {
    return false;
  }
  size_t cursor = 8;
  if (ReadU32(bytes, cursor) != kProtocolVersion) return false;
  header.task = bytes[cursor++];
  if (header.task < 1 || header.task > 8) return false;
  header.locale = bytes[cursor++];
  if (header.locale < 1 || header.locale > 2) return false;
  if (!ReadString(bytes, cursor, header.model_id) ||
      !ReadString(bytes, cursor, header.model_revision) ||
      !AllAscii(header.model_id) || !AllAscii(header.model_revision) ||
      header.model_id.size() > 96 || header.model_revision.size() > 64) {
    return false;
  }
  header.input_bytes = ReadU64(bytes, cursor);
  header.input_width = ReadU32(bytes, cursor);
  header.input_height = ReadU32(bytes, cursor);
  header.output_width = ReadU32(bytes, cursor);
  header.output_height = ReadU32(bytes, cursor);
  if (cursor + kOptionBytes != bytes.size()) return false;
  header.options.task = bytes[cursor++];
  header.options.scale = bytes[cursor++];
  header.options.model = bytes[cursor++];
  header.options.device = bytes[cursor++];
  for (uint32_t& value : header.options.region) {
    value = ReadU32(bytes, cursor);
  }
  header.options.max_output_tokens = ReadU32(bytes, cursor);
  header.options.seed = ReadU64(bytes, cursor);
  header.options.temperature_milli = static_cast<int32_t>(ReadU32(bytes, cursor));
  header.options.threshold_milli = ReadU32(bytes, cursor);
  std::memcpy(header.options.mask, bytes.data() + cursor, 16);
  cursor += 16;
  header.options.embed_mode = bytes[cursor++];
  header.options.translate_to_english = bytes[cursor++];
  header.options.start_us = ReadU64(bytes, cursor);
  header.options.end_us = ReadU64(bytes, cursor);
  header.options.language = bytes[cursor++];
  if (cursor != bytes.size()) return false;
  if (header.options.task != header.task) return false;
  if (header.input_bytes == 0 || header.input_bytes > 256ull * 1024 * 1024 ||
      header.input_width == 0 || header.input_height == 0 ||
      header.output_width == 0 || header.output_height == 0) {
    return false;
  }
  return true;
}

std::string Sha256Hex(const uint8_t* data, size_t length) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  std::string result;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr,
                                 0) < 0) {
    return result;
  }
  DWORD object_size = 0;
  DWORD written = 0;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
                        reinterpret_cast<PUCHAR>(&object_size),
                        sizeof(object_size), &written, 0) < 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return result;
  }
  std::vector<uint8_t> object(object_size);
  if (BCryptCreateHash(algorithm, &hash, object.data(), object_size, nullptr, 0,
                       0) < 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return result;
  }
  const NTSTATUS status =
      BCryptHashData(hash, const_cast<PUCHAR>(data),
                     static_cast<ULONG>(length), 0);
  uint8_t digest[32] = {};
  if (status >= 0) {
    BCryptFinishHash(hash, digest, sizeof(digest), 0);
    static const char* hex = "0123456789abcdef";
    result.reserve(64);
    for (uint8_t byte : digest) {
      result.push_back(hex[byte >> 4]);
      result.push_back(hex[byte & 0x0f]);
    }
  }
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return result;
}

bool IsSafeModelPath(const std::wstring& path) {
  if (path.empty() || path.find(L"..") != std::wstring::npos) return false;
  if (path.size() < 3 || path[1] != L':' || (path[2] != L'\\' && path[2] != L'/')) {
    return false;
  }
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

}  // namespace adpai
