// Fixed PDF rendering for the office_read_v1 bridge.

#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

#include "protocol.hxx"
#include "read_document.hxx"

namespace adp {

struct PageRange {
    std::uint32_t first = 1;
    std::uint32_t last = 1;
};

struct RenderRequest {
    std::string document_id;
    std::string target;
    std::vector<std::string> section_ids;
    std::vector<PageRange> ranges;
    bool include_comments = false;
    bool include_notes = false;
};

struct Artifact {
    std::string section_id;
    std::string relative_name;
    std::string format;
    std::string mime;
    std::uint64_t byte_len = 0;
    std::uint32_t page_count = 1;
    std::string sha256;
};

bool render_document(Document& document,
                     const RenderRequest& request,
                     const std::filesystem::path& output_root,
                     std::vector<Artifact>& artifacts,
                     std::string& error);

Json artifacts_json(const std::vector<Artifact>& artifacts,
                    const Document& document);

}  // namespace adp
