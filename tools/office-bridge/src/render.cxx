#include "render.hxx"

#include <algorithm>
#include <system_error>

#include <com/sun/star/beans/PropertyValue.hpp>
#include <com/sun/star/beans/PropertyState.hpp>
#include <com/sun/star/frame/XStorable.hpp>
#include <com/sun/star/uno/Any.hxx>
#include <com/sun/star/uno/Sequence.hxx>
#include <osl/file.hxx>
#include <rtl/ustring.hxx>

namespace adp {
namespace {

using css::uno::Sequence;

constexpr const char* kEngineVersion = "libreoffice-26.8.2";

css::beans::PropertyValue property(const char* name, css::uno::Any value) {
    css::beans::PropertyValue result;
    result.Name = rtl::OUString::createFromAscii(name);
    result.Handle = -1;
    result.Value = std::move(value);
    result.State = css::beans::PropertyState_DIRECT_VALUE;
    return result;
}

std::string filter_for(const Section& section) {
    if (section.kind == "sheet") return "calc_pdf_Export";
    if (section.kind == "slide") return "impress_pdf_Export";
    return "writer_pdf_Export";
}

std::string page_range_for(const Section& section, const RenderRequest& request) {
    if (!request.ranges.empty()) {
        std::string value;
        for (std::size_t index = 0; index < request.ranges.size(); ++index) {
            if (index != 0) value.push_back(';');
            value += std::to_string(request.ranges[index].first);
            value.push_back('-');
            value += std::to_string(request.ranges[index].last);
        }
        return value;
    }
    if (section.kind == "slide") {
        const std::uint32_t page = section.index + 1;
        return std::to_string(page) + "-" + std::to_string(page);
    }
    if (section.kind == "sheet") {
        // Calc's PDF filter accepts a page range; selecting a sheet's first
        // page avoids exporting every sheet into one section. The parent
        // labels page counts from the engine's actual result.
        const std::uint32_t page = section.index + 1;
        return std::to_string(page) + "-" + std::to_string(page);
    }
    return "1-" + std::to_string(std::max<std::uint32_t>(1, section.page_count));
}

bool safe_output_path(const std::filesystem::path& output_root,
                      const std::filesystem::path& target,
                      std::string& error) {
    std::error_code code;
    const auto root = std::filesystem::weakly_canonical(output_root, code);
    if (code) {
        error = "failed";
        return false;
    }
    const auto candidate = std::filesystem::weakly_canonical(target, code);
    if (code) {
        error = "failed";
        return false;
    }
    const auto root_text = root.u8string();
    const auto candidate_text = candidate.u8string();
    if (candidate_text.size() <= root_text.size() ||
        candidate_text.compare(0, root_text.size(), root_text) != 0 ||
        (candidate_text[root_text.size()] != '\\' && candidate_text[root_text.size()] != '/')) {
        error = "bad_request";
        return false;
    }
    return true;
}

}  // namespace

bool render_document(Document& document,
                     const RenderRequest& request,
                     const std::filesystem::path& output_root,
                     std::vector<Artifact>& artifacts,
                     std::string& error) {
    artifacts.clear();
    if (request.target != "pdf") {
        error = "unsupported";
        return false;
    }
    if (request.include_notes) {
        // The ordinary viewer and audience never ask for notes.
        error = "unsupported";
        return false;
    }
    if (request.section_ids.empty() || request.section_ids.size() > 256) {
        error = "bad_request";
        return false;
    }
    if (!document.storable.is()) {
        error = "failed";
        return false;
    }
    std::error_code code;
    std::filesystem::create_directories(output_root, code);
    if (code) {
        error = "failed";
        return false;
    }
    try {
        for (const std::string& section_id : request.section_ids) {
            const auto found = std::find_if(document.sections.begin(), document.sections.end(),
                                            [&](const Section& section) {
                                                return section.id == section_id;
                                            });
            if (found == document.sections.end()) {
                error = "bad_request";
                return false;
            }
            const Section& section = *found;
            const std::filesystem::path target = output_root / section_filename(section);
            if (!safe_output_path(output_root, target, error)) return false;
            if (std::filesystem::exists(target)) {
                error = "changed";
                return false;
            }
            const std::string target_utf8 = target.u8string();
            rtl::OUString system_path = rtl::OUString::fromUtf8(target_utf8.c_str());
            rtl::OUString url;
            if (osl::FileBase::getFileURLFromSystemPath(system_path, url) !=
                osl::FileBase::E_None) {
                error = "failed";
                return false;
            }
            Sequence<css::beans::PropertyValue> filter_data(2);
            filter_data[0] = property("PageRange", css::uno::Any(
                                                        rtl::OUString::fromUtf8(
                                                            page_range_for(section, request).c_str())));
            filter_data[1] = property("ExportNotes", css::uno::Any(false));
            Sequence<css::beans::PropertyValue> properties(3);
            properties[0] = property("FilterName",
                                     css::uno::Any(rtl::OUString::fromUtf8(
                                         filter_for(section).c_str())));
            properties[1] = property("FilterData", css::uno::Any(filter_data));
            properties[2] = property("Overwrite", css::uno::Any(false));
            try {
                document.storable->storeToURL(url, properties);
            } catch (...) {
                std::filesystem::remove(target, code);
                error = "failed";
                return false;
            }
            if (!source_hash_unchanged(document)) {
                std::filesystem::remove(target, code);
                error = "changed";
                return false;
            }
            if (!std::filesystem::is_regular_file(target, code)) {
                error = "failed";
                return false;
            }
            const auto byte_len = std::filesystem::file_size(target, code);
            if (code || byte_len == 0 || byte_len > 1024ull * 1024ull * 1024ull) {
                std::filesystem::remove(target, code);
                error = byte_len > 1024ull * 1024ull * 1024ull ? "failed"
                                                               : "failed";
                return false;
            }
            const std::string sha = sha256_file(target);
            if (sha.size() != 64) {
                std::filesystem::remove(target, code);
                error = "failed";
                return false;
            }
            Artifact artifact;
            artifact.section_id = section.id;
            artifact.relative_name = section_filename(section);
            artifact.format = "pdf";
            artifact.mime = "application/pdf";
            artifact.byte_len = byte_len;
            artifact.page_count = std::max<std::uint32_t>(1, section.page_count);
            artifact.sha256 = sha;
            artifacts.push_back(std::move(artifact));
        }
    } catch (...) {
        for (const Artifact& artifact : artifacts) {
            std::filesystem::remove(output_root / artifact.relative_name, code);
        }
        artifacts.clear();
        error = "failed";
        return false;
    }
    error.clear();
    return true;
}

Json artifacts_json(const std::vector<Artifact>& artifacts, const Document& document) {
    std::vector<Json> values;
    for (const Artifact& artifact : artifacts) {
        std::map<std::string, Json> item;
        item.emplace("relative_name", Json::string_value(artifact.relative_name));
        item.emplace("section_id", Json::string_value(artifact.section_id));
        item.emplace("format", Json::string_value(artifact.format));
        item.emplace("mime", Json::string_value(artifact.mime));
        item.emplace("byte_len", Json::int_value(static_cast<std::int64_t>(artifact.byte_len)));
        item.emplace("page_count", Json::int_value(artifact.page_count));
        item.emplace("sha256", Json::string_value(artifact.sha256));
        values.push_back(Json::object_value(std::move(item)));
    }
    std::map<std::string, Json> root;
    root.emplace("artifacts", Json::array_value(std::move(values)));
    root.emplace("engine_version", Json::string_value(kEngineVersion));
    root.emplace("source_revision",
                 Json::int_value(static_cast<std::int64_t>(document.source_revision)));
    return Json::object_value(std::move(root));
}

}  // namespace adp
