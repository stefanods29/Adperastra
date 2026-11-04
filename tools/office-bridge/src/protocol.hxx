// Adperastra Office read bridge (Step 13 T3).
//
// The bridge is a replaceable pack program. It speaks only the fixed
// office_read_v1 framed protocol on its inherited stdin/stdout, resolves
// input/output names under its private working directory, and never accepts
// a user path, program argument, URL or arbitrary UNO method.

#pragma once

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <iosfwd>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace adp {

constexpr std::uint32_t kProtocolVersion = 1;
constexpr std::uint8_t kFrameRequest = 1;
constexpr std::uint8_t kFrameReply = 2;
constexpr std::uint8_t kFrameHeartbeat = 3;
constexpr std::uint8_t kFrameCancel = 4;
constexpr std::size_t kMaxControlBytes = 768 * 1024;
constexpr std::size_t kMaxFrameBytes = kMaxControlBytes;
constexpr int kMaxJsonDepth = 64;

// The only UNO load properties this bridge sets (13 D3). These values are
// also checked by native tests; they are deliberately not configurable from
// the wire.
constexpr bool kLoadHidden = true;
constexpr bool kLoadReadOnly = true;
constexpr short kMacroExecutionNever = 0;
constexpr short kUpdateDocNever = 0;

struct Json {
    enum class Type { Null, Bool, Number, String, Array, Object };

    Type type = Type::Null;
    bool boolean = false;
    bool integer = true;
    std::int64_t number_int = 0;
    double number_real = 0.0;
    std::string string;
    std::vector<Json> array;
    std::map<std::string, Json> object;

    static Json null();
    static Json boolean_value(bool value);
    static Json int_value(std::int64_t value);
    static Json number_value(double value);
    static Json string_value(std::string value);
    static Json array_value(std::vector<Json> values = {});
    static Json object_value(std::map<std::string, Json> values = {});

    bool is_null() const { return type == Type::Null; }
    bool is_object() const { return type == Type::Object; }
    bool is_array() const { return type == Type::Array; }
    bool is_string() const { return type == Type::String; }
    bool is_number() const { return type == Type::Number; }
    bool is_bool() const { return type == Type::Bool; }

    const Json* get(const std::string& key) const;
    Json* get(const std::string& key);
    const std::string* string_or_null(const std::string& key) const;
    bool bool_or(const std::string& key, bool fallback) const;
    std::int64_t int_or(const std::string& key, std::int64_t fallback) const;

    std::string dump() const;
};

bool parse_json(const std::string& text, Json& out, std::string& error);

struct Frame {
    std::uint8_t kind = 0;
    std::string body;
};

bool read_frame(std::istream& input, Frame& frame, std::string& error);
bool write_frame(std::ostream& output, std::uint8_t kind, const std::string& body);

// Thread-safe replies/heartbeats: a render worker and the request reader can
// both write stdout.
class FrameWriter {
public:
    explicit FrameWriter(std::ostream& output) : output_(output) {}

    bool reply(const std::string& request_id, Json result);
    bool heartbeat(const std::string& request_id, std::uint64_t completed,
                   const std::int64_t* total);
    bool error_reply(const std::string& request_id, const std::string& code);

private:
    std::mutex mutex_;
    std::ostream& output_;
};

std::string uuid_v4();
bool valid_uuid(const std::string& value);
bool valid_basename(const std::string& value);
std::string lowercase_ascii(std::string value);
std::int64_t unix_seconds();
std::string sha256_file(const std::filesystem::path& path);

// Copy at most max_bytes from a stream, returning false when the stream is
// larger or reading fails. Callers keep output in memory only for bounded
// XML parts.
bool read_bounded(std::istream& input, std::size_t max_bytes, std::string& out);

}  // namespace adp
