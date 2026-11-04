#include "protocol.hxx"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <fstream>
#include <iomanip>
#include <random>
#include <sstream>
#include <stdexcept>
#include <system_error>

#pragma comment(lib, "bcrypt.lib")

namespace adp {
namespace {

void append_utf8(std::string& out, std::uint32_t code) {
    if (code <= 0x7f) {
        out.push_back(static_cast<char>(code));
    } else if (code <= 0x7ff) {
        out.push_back(static_cast<char>(0xc0 | (code >> 6)));
        out.push_back(static_cast<char>(0x80 | (code & 0x3f)));
    } else if (code <= 0xffff) {
        out.push_back(static_cast<char>(0xe0 | (code >> 12)));
        out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
        out.push_back(static_cast<char>(0x80 | (code & 0x3f)));
    } else if (code <= 0x10ffff) {
        out.push_back(static_cast<char>(0xf0 | (code >> 18)));
        out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3f)));
        out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
        out.push_back(static_cast<char>(0x80 | (code & 0x3f)));
    }
}

class Parser {
public:
    explicit Parser(const std::string& text) : text_(text) {}

    bool parse(Json& out) {
        skip_space();
        if (!value(out, 0)) return false;
        skip_space();
        if (pos_ != text_.size()) return fail("trailing bytes");
        return true;
    }

    const std::string& error() const { return error_; }

private:
    bool fail(const char* message) {
        if (error_.empty()) error_ = message;
        return false;
    }

    void skip_space() {
        while (pos_ < text_.size() &&
               (text_[pos_] == ' ' || text_[pos_] == '\t' || text_[pos_] == '\n' ||
                text_[pos_] == '\r')) {
            ++pos_;
        }
    }

    bool value(Json& out, int depth) {
        if (depth > kMaxJsonDepth) return fail("depth");
        skip_space();
        if (pos_ >= text_.size()) return fail("unexpected end");
        switch (text_[pos_]) {
            case 'n':
                if (!literal("null")) return false;
                out = Json::null();
                return true;
            case 't':
                if (!literal("true")) return false;
                out = Json::boolean_value(true);
                return true;
            case 'f':
                if (!literal("false")) return false;
                out = Json::boolean_value(false);
                return true;
            case '"': {
                std::string value;
                if (!string_value(value)) return false;
                out = Json::string_value(std::move(value));
                return true;
            }
            case '[': {
                ++pos_;
                out = Json::array_value();
                skip_space();
                if (pos_ < text_.size() && text_[pos_] == ']') {
                    ++pos_;
                    return true;
                }
                for (;;) {
                    Json item;
                    if (!value(item, depth + 1)) return false;
                    out.array.push_back(std::move(item));
                    if (out.array.size() > 1'000'000) return fail("array");
                    skip_space();
                    if (pos_ >= text_.size()) return fail("array end");
                    if (text_[pos_] == ',') {
                        ++pos_;
                        continue;
                    }
                    if (text_[pos_] == ']') {
                        ++pos_;
                        return true;
                    }
                    return fail("array separator");
                }
            }
            case '{': {
                ++pos_;
                out = Json::object_value();
                skip_space();
                if (pos_ < text_.size() && text_[pos_] == '}') {
                    ++pos_;
                    return true;
                }
                for (;;) {
                    skip_space();
                    if (pos_ >= text_.size() || text_[pos_] != '"') return fail("object key");
                    std::string key;
                    if (!string_value(key)) return false;
                    skip_space();
                    if (pos_ >= text_.size() || text_[pos_] != ':') return fail("object colon");
                    ++pos_;
                    Json item;
                    if (!value(item, depth + 1)) return false;
                    if (!out.object.emplace(std::move(key), std::move(item)).second) {
                        return fail("duplicate object key");
                    }
                    if (out.object.size() > 4096) return fail("object size");
                    skip_space();
                    if (pos_ >= text_.size()) return fail("object end");
                    if (text_[pos_] == ',') {
                        ++pos_;
                        continue;
                    }
                    if (text_[pos_] == '}') {
                        ++pos_;
                        return true;
                    }
                    return fail("object separator");
                }
            }
            default:
                return number_value(out);
        }
    }

    bool literal(const char* value) {
        const std::size_t length = std::char_traits<char>::length(value);
        if (text_.compare(pos_, length, value) != 0) return fail("literal");
        pos_ += length;
        return true;
    }

    bool string_value(std::string& out) {
        if (pos_ >= text_.size() || text_[pos_] != '"') return fail("string");
        ++pos_;
        while (pos_ < text_.size()) {
            const unsigned char value = static_cast<unsigned char>(text_[pos_++]);
            if (value == '"') return true;
            if (value < 0x20) return fail("control in string");
            if (value != '\\') {
                out.push_back(static_cast<char>(value));
                if (out.size() > kMaxControlBytes) return fail("string size");
                continue;
            }
            if (pos_ >= text_.size()) return fail("escape");
            const char escaped = text_[pos_++];
            switch (escaped) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    std::uint32_t code = 0;
                    if (!hex4(code)) return false;
                    if (code >= 0xd800 && code <= 0xdbff) {
                        if (pos_ + 1 >= text_.size() || text_[pos_] != '\\' || text_[pos_ + 1] != 'u') {
                            return fail("surrogate");
                        }
                        pos_ += 2;
                        std::uint32_t low = 0;
                        if (!hex4(low) || low < 0xdc00 || low > 0xdfff) return fail("surrogate");
                        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                    } else if (code >= 0xdc00 && code <= 0xdfff) {
                        return fail("surrogate");
                    }
                    append_utf8(out, code);
                    break;
                }
                default:
                    return fail("escape");
            }
            if (out.size() > kMaxControlBytes) return fail("string size");
        }
        return fail("string end");
    }

    bool hex4(std::uint32_t& out) {
        if (pos_ + 4 > text_.size()) return fail("hex");
        out = 0;
        for (int index = 0; index < 4; ++index) {
            const char value = text_[pos_++];
            out <<= 4;
            if (value >= '0' && value <= '9') out |= static_cast<std::uint32_t>(value - '0');
            else if (value >= 'a' && value <= 'f') out |= static_cast<std::uint32_t>(value - 'a' + 10);
            else if (value >= 'A' && value <= 'F') out |= static_cast<std::uint32_t>(value - 'A' + 10);
            else return fail("hex");
        }
        return true;
    }

    bool number_value(Json& out) {
        const std::size_t start = pos_;
        if (pos_ < text_.size() && text_[pos_] == '-') ++pos_;
        if (pos_ >= text_.size() || !std::isdigit(static_cast<unsigned char>(text_[pos_]))) {
            return fail("number");
        }
        if (text_[pos_] == '0') {
            ++pos_;
        } else {
            while (pos_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[pos_]))) ++pos_;
        }
        bool integer = true;
        if (pos_ < text_.size() && text_[pos_] == '.') {
            integer = false;
            ++pos_;
            if (pos_ >= text_.size() || !std::isdigit(static_cast<unsigned char>(text_[pos_]))) {
                return fail("fraction");
            }
            while (pos_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[pos_]))) ++pos_;
        }
        if (pos_ < text_.size() && (text_[pos_] == 'e' || text_[pos_] == 'E')) {
            integer = false;
            ++pos_;
            if (pos_ < text_.size() && (text_[pos_] == '+' || text_[pos_] == '-')) ++pos_;
            if (pos_ >= text_.size() || !std::isdigit(static_cast<unsigned char>(text_[pos_]))) {
                return fail("exponent");
            }
            while (pos_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[pos_]))) ++pos_;
        }
        const std::string value = text_.substr(start, pos_ - start);
        try {
            if (integer) {
                std::int64_t parsed = 0;
                const auto result = std::from_chars(value.data(), value.data() + value.size(), parsed);
                if (result.ec != std::errc() || result.ptr != value.data() + value.size()) {
                    return fail("integer");
                }
                out = Json::int_value(parsed);
            } else {
                std::size_t used = 0;
                const double parsed = std::stod(value, &used);
                if (used != value.size()) return fail("number");
                out = Json::number_value(parsed);
            }
        } catch (...) {
            return fail("number");
        }
        return true;
    }

    const std::string& text_;
    std::size_t pos_ = 0;
    std::string error_;
};

std::string escape_string(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 2);
    out.push_back('"');
    for (unsigned char character : value) {
        switch (character) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (character < 0x20) {
                    char buffer[7] = {};
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", character);
                    out += buffer;
                } else {
                    out.push_back(static_cast<char>(character));
                }
        }
    }
    out.push_back('"');
    return out;
}

std::string hex_bytes(const unsigned char* bytes, std::size_t length) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.resize(length * 2);
    for (std::size_t index = 0; index < length; ++index) {
        out[index * 2] = digits[bytes[index] >> 4];
        out[index * 2 + 1] = digits[bytes[index] & 0xf];
    }
    return out;
}

}  // namespace

Json Json::null() {
    Json value;
    value.type = Type::Null;
    return value;
}

Json Json::boolean_value(bool input) {
    Json value;
    value.type = Type::Bool;
    value.boolean = input;
    return value;
}

Json Json::int_value(std::int64_t input) {
    Json value;
    value.type = Type::Number;
    value.integer = true;
    value.number_int = input;
    value.number_real = static_cast<double>(input);
    return value;
}

Json Json::number_value(double input) {
    Json value;
    value.type = Type::Number;
    value.integer = false;
    value.number_real = input;
    value.number_int = static_cast<std::int64_t>(input);
    return value;
}

Json Json::string_value(std::string input) {
    Json value;
    value.type = Type::String;
    value.string = std::move(input);
    return value;
}

Json Json::array_value(std::vector<Json> input) {
    Json value;
    value.type = Type::Array;
    value.array = std::move(input);
    return value;
}

Json Json::object_value(std::map<std::string, Json> input) {
    Json value;
    value.type = Type::Object;
    value.object = std::move(input);
    return value;
}

const Json* Json::get(const std::string& key) const {
    if (type != Type::Object) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &found->second;
}

Json* Json::get(const std::string& key) {
    if (type != Type::Object) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &found->second;
}

const std::string* Json::string_or_null(const std::string& key) const {
    const Json* value = get(key);
    return value != nullptr && value->type == Type::String ? &value->string : nullptr;
}

bool Json::bool_or(const std::string& key, bool fallback) const {
    const Json* value = get(key);
    return value != nullptr && value->type == Type::Bool ? value->boolean : fallback;
}

std::int64_t Json::int_or(const std::string& key, std::int64_t fallback) const {
    const Json* value = get(key);
    if (value == nullptr || value->type != Type::Number) return fallback;
    return value->integer ? value->number_int : static_cast<std::int64_t>(value->number_real);
}

std::string Json::dump() const {
    switch (type) {
        case Type::Null: return "null";
        case Type::Bool: return boolean ? "true" : "false";
        case Type::Number: {
            if (integer) return std::to_string(number_int);
            std::ostringstream stream;
            stream << std::setprecision(17) << number_real;
            return stream.str();
        }
        case Type::String: return escape_string(string);
        case Type::Array: {
            std::string out = "[";
            for (std::size_t index = 0; index < array.size(); ++index) {
                if (index != 0) out.push_back(',');
                out += array[index].dump();
            }
            out.push_back(']');
            return out;
        }
        case Type::Object: {
            std::string out = "{";
            std::size_t index = 0;
            for (const auto& [key, value] : object) {
                if (index++ != 0) out.push_back(',');
                out += escape_string(key);
                out.push_back(':');
                out += value.dump();
            }
            out.push_back('}');
            return out;
        }
    }
    return "null";
}

bool parse_json(const std::string& text, Json& out, std::string& error) {
    if (text.size() > kMaxControlBytes) {
        error = "control too large";
        return false;
    }
    Parser parser(text);
    if (!parser.parse(out)) {
        error = parser.error();
        return false;
    }
    return true;
}

bool read_frame(std::istream& input, Frame& frame, std::string& error) {
    unsigned char header[5] = {};
    input.read(reinterpret_cast<char*>(header), sizeof(header));
    if (input.gcount() == 0) {
        error = "closed";
        return false;
    }
    if (input.gcount() != static_cast<std::streamsize>(sizeof(header))) {
        error = "truncated header";
        return false;
    }
    const std::uint32_t length = static_cast<std::uint32_t>(header[1]) |
                                 (static_cast<std::uint32_t>(header[2]) << 8) |
                                 (static_cast<std::uint32_t>(header[3]) << 16) |
                                 (static_cast<std::uint32_t>(header[4]) << 24);
    if (length > kMaxFrameBytes) {
        error = "frame too large";
        return false;
    }
    frame.kind = header[0];
    frame.body.assign(length, '\0');
    if (length != 0) {
        input.read(frame.body.data(), static_cast<std::streamsize>(length));
        if (input.gcount() != static_cast<std::streamsize>(length)) {
            error = "truncated body";
            return false;
        }
    }
    return true;
}

bool write_frame(std::ostream& output, std::uint8_t kind, const std::string& body) {
    if (kind == 0 || body.size() > kMaxFrameBytes) return false;
    const std::uint32_t length = static_cast<std::uint32_t>(body.size());
    unsigned char header[5] = {
        kind,
        static_cast<unsigned char>(length & 0xff),
        static_cast<unsigned char>((length >> 8) & 0xff),
        static_cast<unsigned char>((length >> 16) & 0xff),
        static_cast<unsigned char>((length >> 24) & 0xff),
    };
    output.write(reinterpret_cast<const char*>(header), sizeof(header));
    if (!body.empty()) output.write(body.data(), static_cast<std::streamsize>(body.size()));
    output.flush();
    return output.good();
}

bool FrameWriter::reply(const std::string& request_id, Json result) {
    std::map<std::string, Json> value;
    value.emplace("protocol_version", Json::int_value(kProtocolVersion));
    value.emplace("request_id", Json::string_value(request_id));
    value.emplace("result", std::move(result));
    std::lock_guard<std::mutex> lock(mutex_);
    return write_frame(output_, kFrameReply, Json::object_value(std::move(value)).dump());
}

bool FrameWriter::heartbeat(const std::string& request_id, std::uint64_t completed,
                            const std::int64_t* total) {
    std::map<std::string, Json> value;
    value.emplace("protocol_version", Json::int_value(kProtocolVersion));
    value.emplace("request_id", Json::string_value(request_id));
    value.emplace("completed_units", Json::int_value(static_cast<std::int64_t>(completed)));
    value.emplace("total_units", total == nullptr ? Json::null() : Json::int_value(*total));
    std::lock_guard<std::mutex> lock(mutex_);
    return write_frame(output_, kFrameHeartbeat, Json::object_value(std::move(value)).dump());
}

bool FrameWriter::error_reply(const std::string& request_id, const std::string& code) {
    std::map<std::string, Json> result;
    result.emplace("result", Json::string_value("error"));
    result.emplace("code", Json::string_value(code));
    return reply(request_id, Json::object_value(std::move(result)));
}

std::string uuid_v4() {
    std::random_device device;
    std::mt19937_64 engine(device());
    unsigned char bytes[16] = {};
    for (unsigned char& byte : bytes) byte = static_cast<unsigned char>(engine() & 0xff);
    bytes[6] = static_cast<unsigned char>((bytes[6] & 0x0f) | 0x40);
    bytes[8] = static_cast<unsigned char>((bytes[8] & 0x3f) | 0x80);
    const std::string hex = hex_bytes(bytes, sizeof(bytes));
    return hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" +
           hex.substr(16, 4) + "-" + hex.substr(20, 12);
}

bool valid_uuid(const std::string& value) {
    if (value.size() != 36) return false;
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (index == 8 || index == 13 || index == 18 || index == 23) {
            if (value[index] != '-') return false;
        } else if (!std::isxdigit(static_cast<unsigned char>(value[index]))) {
            return false;
        }
    }
    return true;
}

bool valid_basename(const std::string& value) {
    if (value.empty() || value.size() > 255 || value == "." || value == "..") return false;
    if (value.back() == '.' || value.back() == ' ') return false;
    for (unsigned char character : value) {
        if (character < 0x20 || character == '/' || character == '\\' || character == ':') {
            return false;
        }
    }
    return true;
}

std::string lowercase_ascii(std::string value) {
    for (char& character : value) {
        character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
    }
    return value;
}

std::int64_t unix_seconds() {
    return static_cast<std::int64_t>(std::chrono::duration_cast<std::chrono::seconds>(
                                         std::chrono::system_clock::now().time_since_epoch())
                                         .count());
}

std::string sha256_file(const std::filesystem::path& path) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::string result;
    DWORD object_length = 0;
    DWORD hash_length = 0;
    DWORD produced = 0;
    std::vector<unsigned char> object;
    std::vector<unsigned char> digest;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) {
        return result;
    }
    if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
                          reinterpret_cast<PUCHAR>(&object_length), sizeof(object_length), &produced, 0) < 0 ||
        BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hash_length),
                          sizeof(hash_length), &produced, 0) < 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return result;
    }
    object.resize(object_length);
    digest.resize(hash_length);
    if (BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0, 0) < 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return result;
    }
    std::ifstream input(path, std::ios::binary);
    std::array<char, 1024 * 1024> buffer{};
    bool ok = input.good();
    while (ok && input) {
        input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const std::streamsize count = input.gcount();
        if (count > 0) {
            ok = BCryptHashData(hash, reinterpret_cast<PUCHAR>(buffer.data()),
                                static_cast<ULONG>(count), 0) >= 0;
        }
    }
    if (ok && BCryptFinishHash(hash, digest.data(), hash_length, 0) >= 0) {
        result = hex_bytes(digest.data(), digest.size());
    }
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return result;
}

bool read_bounded(std::istream& input, std::size_t max_bytes, std::string& out) {
    out.clear();
    char buffer[64 * 1024];
    while (input) {
        input.read(buffer, sizeof(buffer));
        const std::streamsize count = input.gcount();
        if (count <= 0) break;
        if (out.size() + static_cast<std::size_t>(count) > max_bytes) return false;
        out.append(buffer, static_cast<std::size_t>(count));
    }
    return input.eof() || input.good();
}

}  // namespace adp
