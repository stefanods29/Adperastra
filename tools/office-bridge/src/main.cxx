// Office read bridge entry point.
//
// The native parent creates the private working directory, copies the
// read-only source into ./input, starts this program inside the AppContainer
// and speaks office_read_v1 on stdin/stdout. There is no command-line path,
// no network listener, no arbitrary UNO method and no document macro bridge.

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "protocol.hxx"
#include "read_document.hxx"
#include "render.hxx"

namespace {

using adp::Json;

struct Request {
    std::string id;
    Json command;
    std::shared_ptr<std::atomic<bool>> cancelled = std::make_shared<std::atomic<bool>>(false);
};

std::string command_kind(const Json& command, std::string& error) {
    if (command.is_string()) return command.string;
    if (!command.is_object()) {
        error = "bad_request";
        return {};
    }
    const std::string* kind = command.string_or_null("kind");
    if (kind != nullptr) return *kind;
    // 12b EngineSessionCommand uses the internally tagged `command` field.
    const std::string* fixed = command.string_or_null("command");
    if (fixed != nullptr) return *fixed;
    // Accept a single named command object as a convenience for the fixed
    // wire; no caller-supplied name selects an arbitrary operation.
    for (const char* candidate : {"open", "render", "close_document", "close"}) {
        if (command.get(candidate) != nullptr) return candidate;
    }
    error = "bad_request";
    return {};
}

const Json* command_payload(const Json& command) {
    if (!command.is_object()) return &command;
    if (const Json* request = command.get("request");
        request != nullptr && request->is_object()) {
        return request;
    }
    const std::string* kind = command.string_or_null("kind");
    if (kind != nullptr) return &command;
    for (const char* candidate : {"open", "render", "close_document", "close"}) {
        if (const Json* value = command.get(candidate); value != nullptr && value->is_object()) {
            return value;
        }
    }
    return &command;
}

std::string string_field(const Json& value, const char* name, std::string& error) {
    const std::string* text = value.string_or_null(name);
    if (text == nullptr) {
        error = "bad_request";
        return {};
    }
    return *text;
}

std::shared_ptr<std::atomic<bool>> cancel_for(
    std::mutex& mutex,
    std::map<std::string, std::shared_ptr<std::atomic<bool>>>& active,
    const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex);
    const auto found = active.find(id);
    return found == active.end() ? nullptr : found->second;
}

bool resolve_private_file(const std::filesystem::path& root,
                          const std::string& name,
                          std::filesystem::path& out,
                          std::string& error) {
    if (!adp::valid_basename(name)) {
        error = "bad_request";
        return false;
    }
    std::error_code code;
    const auto canonical_root = std::filesystem::weakly_canonical(root, code);
    if (code) {
        error = "failed";
        return false;
    }
    const auto candidate = std::filesystem::weakly_canonical(root / name, code);
    if (code) {
        error = "failed";
        return false;
    }
    const std::string root_text = canonical_root.u8string();
    const std::string candidate_text = candidate.u8string();
    if (candidate_text.size() <= root_text.size() ||
        candidate_text.compare(0, root_text.size(), root_text) != 0 ||
        (candidate_text[root_text.size()] != '\\' && candidate_text[root_text.size()] != '/')) {
        error = "bad_request";
        return false;
    }
    if (!std::filesystem::is_regular_file(candidate, code)) {
        error = "changed";
        return false;
    }
    out = candidate;
    return true;
}

bool parse_ranges(const Json& payload, std::vector<adp::PageRange>& ranges, std::string& error) {
    const Json* value = payload.get("ranges");
    if (value == nullptr || value->is_null()) return true;
    if (!value->is_array() || value->array.size() > 1'000) {
        error = "bad_request";
        return false;
    }
    for (const Json& item : value->array) {
        if (!item.is_object()) {
            error = "bad_request";
            return false;
        }
        const std::int64_t first = item.int_or("first", 0);
        const std::int64_t last = item.int_or("last", 0);
        if (first < 1 || last < first || last > 10'000) {
            error = "bad_request";
            return false;
        }
        ranges.push_back(adp::PageRange{static_cast<std::uint32_t>(first),
                                        static_cast<std::uint32_t>(last)});
    }
    return true;
}

bool parse_section_ids(const Json& payload, std::vector<std::string>& ids, std::string& error) {
    const Json* value = payload.get("section_ids");
    if (value == nullptr || !value->is_array() || value->array.empty() ||
        value->array.size() > 256) {
        error = "bad_request";
        return false;
    }
    for (const Json& item : value->array) {
        if (!item.is_string() || item.string.empty() || item.string.size() > 64) {
            error = "bad_request";
            return false;
        }
        ids.push_back(item.string);
    }
    return true;
}

void handle_open(const Request& request, adp::FrameWriter& writer,
                 std::map<std::string, adp::Document>& documents, std::string& error) {
    const Json* payload = command_payload(request.command);
    const std::string document_id = string_field(*payload, "document_id", error);
    if (!error.empty()) return;
    const std::string input_name = string_field(*payload, "input_name", error);
    if (!error.empty()) return;
    const std::string format = string_field(*payload, "format", error);
    if (!error.empty()) return;
    const std::int64_t revision = payload->int_or("source_revision", 0);
    if (revision < 1 || revision > (1ll << 53) - 1) {
        error = "bad_request";
        return;
    }
    if (!adp::valid_uuid(document_id)) {
        error = "bad_request";
        return;
    }
    std::string content_id;
    const Json* content = payload->get("source_content_id");
    if (content != nullptr && content->is_string()) {
        if (!adp::valid_uuid(content->string)) {
            error = "bad_request";
            return;
        }
        content_id = content->string;
    }
    if (documents.find(document_id) != documents.end()) {
        error = "changed";
        return;
    }
    std::filesystem::path input;
    if (!resolve_private_file(std::filesystem::current_path() / "input", input_name, input, error)) {
        return;
    }
    std::error_code code;
    if (std::filesystem::file_size(input, code) > 512ull * 1024ull * 1024ull || code) {
        error = "failed";
        return;
    }
    adp::Document document;
    if (!adp::open_document(input, format, static_cast<std::uint64_t>(revision), content_id,
                            document, error)) {
        return;
    }
    document.document_id = document_id;
    // The native parent owns a missing source_content_id; the bridge never
    // invents one that could disagree with the retained input authorization.
    documents.emplace(document_id, std::move(document));
    if (!writer.heartbeat(request.id, 1, nullptr)) {
        error = "failed";
        return;
    }
    std::map<std::string, Json> result;
    result.emplace("result", Json::string_value("opened"));
    result.emplace("document", adp::document_json(documents.at(document_id)));
    writer.reply(request.id, Json::object_value(std::move(result)));
}

void handle_render(const Request& request, adp::FrameWriter& writer,
                   std::map<std::string, adp::Document>& documents, std::string& error) {
    if (request.cancelled->load()) {
        error = "cancelled";
        return;
    }
    const Json* payload = command_payload(request.command);
    const std::string document_id = string_field(*payload, "document_id", error);
    if (!error.empty()) return;
    const auto found = documents.find(document_id);
    if (found == documents.end()) {
        error = "changed";
        return;
    }
    adp::RenderRequest render;
    render.document_id = document_id;
    render.target = string_field(*payload, "target", error);
    if (!error.empty()) return;
    if (!parse_section_ids(*payload, render.section_ids, error)) return;
    if (!parse_ranges(*payload, render.ranges, error)) return;
    render.include_comments = payload->bool_or("include_comments", false);
    render.include_notes = payload->bool_or("include_notes", false);
    std::vector<adp::Artifact> artifacts;
    if (!adp::render_document(found->second, render, std::filesystem::current_path() / "output",
                              artifacts, error)) {
        return;
    }
    if (request.cancelled->load()) {
        std::error_code code;
        for (const adp::Artifact& artifact : artifacts) {
            std::filesystem::remove(std::filesystem::current_path() / "output" /
                                        artifact.relative_name,
                                    code);
        }
        artifacts.clear();
        error = "cancelled";
        return;
    }
    std::map<std::string, Json> result;
    result.emplace("result", Json::string_value("rendered"));
    Json rendered = adp::artifacts_json(artifacts, found->second);
    if (const Json* values = rendered.get("artifacts"); values != nullptr) {
        result.emplace("artifacts", *values);
    }
    writer.reply(request.id, Json::object_value(std::move(result)));
    writer.heartbeat(request.id, 1, nullptr);
}

void handle_close_document(const Request& request, adp::FrameWriter& writer,
                           std::map<std::string, adp::Document>& documents, std::string& error) {
    const Json* payload = command_payload(request.command);
    const std::string id = string_field(*payload, "document_id", error);
    if (!error.empty()) return;
    const auto found = documents.find(id);
    if (found != documents.end()) {
        adp::close_document(found->second, error);
        documents.erase(found);
        if (!error.empty()) return;
    }
    std::map<std::string, Json> result;
    result.emplace("result", Json::string_value("closed"));
    writer.reply(request.id, Json::object_value(std::move(result)));
}

void handle_close_all(const Request& request, adp::FrameWriter& writer,
                      std::map<std::string, adp::Document>& documents, std::string& error) {
    for (auto& [id, document] : documents) {
        std::string close_error;
        adp::close_document(document, close_error);
        if (!close_error.empty()) error = close_error;
    }
    documents.clear();
    if (!error.empty()) return;
    std::map<std::string, Json> result;
    result.emplace("result", Json::string_value("closed"));
    writer.reply(request.id, Json::object_value(std::move(result)));
}

}  // namespace

int main() {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::ios::sync_with_stdio(false);
    adp::FrameWriter writer(std::cout);
    std::mutex queue_mutex;
    std::condition_variable queue_ready;
    std::deque<std::shared_ptr<Request>> queue;
    bool stopping = false;
    std::mutex active_mutex;
    std::map<std::string, std::shared_ptr<std::atomic<bool>>> active;
    std::map<std::string, adp::Document> documents;

    std::thread worker([&] {
        for (;;) {
            std::shared_ptr<Request> request;
            {
                std::unique_lock<std::mutex> lock(queue_mutex);
                queue_ready.wait(lock, [&] { return stopping || !queue.empty(); });
                if (queue.empty()) {
                    if (stopping) break;
                    continue;
                }
                request = queue.front();
                queue.pop_front();
            }
            if (!request) continue;
            std::string error;
            std::string kind;
            try {
                kind = command_kind(request->command, error);
                if (error.empty()) {
                    if (kind == "open") {
                        handle_open(*request, writer, documents, error);
                    } else if (kind == "render") {
                        handle_render(*request, writer, documents, error);
                    } else if (kind == "close_document") {
                        handle_close_document(*request, writer, documents, error);
                    } else if (kind == "close") {
                        handle_close_all(*request, writer, documents, error);
                    } else {
                        error = "bad_request";
                    }
                }
            } catch (...) {
                error = "failed";
            }
            if (!error.empty()) {
                writer.error_reply(request->id, error);
            }
            {
                std::lock_guard<std::mutex> lock(active_mutex);
                active.erase(request->id);
            }
        }
        for (auto& [id, document] : documents) {
            std::string error;
            adp::close_document(document, error);
        }
        documents.clear();
    });

    bool failed = false;
    for (;;) {
        adp::Frame frame;
        std::string error;
        if (!adp::read_frame(std::cin, frame, error)) {
            if (error != "closed") failed = true;
            break;
        }
        if (frame.kind == adp::kFrameRequest) {
            Json value;
            if (!adp::parse_json(frame.body, value, error)) {
                failed = true;
                break;
            }
            if (!value.is_object() || value.int_or("protocol_version", 0) != adp::kProtocolVersion) {
                failed = true;
                break;
            }
            const std::string* id = value.string_or_null("request_id");
            if (id == nullptr || !adp::valid_uuid(*id)) {
                failed = true;
                break;
            }
            const Json* command = value.get("command");
            if (command == nullptr) {
                failed = true;
                break;
            }
            auto request = std::make_shared<Request>();
            request->id = *id;
            request->command = *command;
            {
                std::lock_guard<std::mutex> lock(active_mutex);
                if (active.find(request->id) != active.end()) {
                    failed = true;
                    break;
                }
                active.emplace(request->id, request->cancelled);
            }
            {
                std::lock_guard<std::mutex> lock(queue_mutex);
                queue.push_back(request);
            }
            queue_ready.notify_one();
        } else if (frame.kind == adp::kFrameCancel) {
            Json value;
            if (!adp::parse_json(frame.body, value, error)) {
                failed = true;
                break;
            }
            const std::string* id = value.string_or_null("request_id");
            if (id == nullptr) {
                failed = true;
                break;
            }
            auto flag = cancel_for(active_mutex, active, *id);
            if (flag) flag->store(true);
        } else if (frame.kind != adp::kFrameHeartbeat) {
            failed = true;
            break;
        }
    }
    {
        std::lock_guard<std::mutex> lock(queue_mutex);
        stopping = true;
    }
    queue_ready.notify_all();
    worker.join();
    return failed ? 1 : 0;
}
