// Read-only LibreOffice document ownership for the office_read_v1 bridge.

#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

#include <com/sun/star/frame/XController.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/lang/XComponent.hpp>
#include <com/sun/star/lang/XServiceInfo.hpp>
#include <com/sun/star/util/XCloseable.hpp>
#include <com/sun/star/frame/XStorable.hpp>
#include <com/sun/star/uno/Reference.hxx>

#include "protocol.hxx"
#include "sections.hxx"

namespace adp {

struct Document {
    std::string document_id;
    std::string format;
    std::uint64_t source_revision = 1;
    std::string source_content_id;
    std::filesystem::path source_path;
    std::string source_sha256;
    css::uno::Reference<css::lang::XComponent> component;
    css::uno::Reference<css::lang::XServiceInfo> service_info;
    css::uno::Reference<css::frame::XModel> model;
    css::uno::Reference<css::frame::XController> controller;
    css::uno::Reference<css::frame::XStorable> storable;
    css::uno::Reference<css::util::XCloseable> closeable;
    std::vector<Section> sections;
};

// Loads one already-authorized private input copy with Hidden=true,
// ReadOnly=true, MacroExecutionMode=NEVER_EXECUTE and UpdateDocMode=NO_UPDATE.
bool open_document(const std::filesystem::path& source_path,
                   const std::string& format,
                   std::uint64_t source_revision,
                   const std::string& source_content_id,
                   Document& document,
                   std::string& error);

bool close_document(Document& document, std::string& error);

// A render must never alter the copied source. The bridge hashes the source
// before opening and again before returning an artifact.
bool source_hash_unchanged(const Document& document);

Json document_json(const Document& document);

}  // namespace adp
