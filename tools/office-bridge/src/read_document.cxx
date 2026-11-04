#include "read_document.hxx"

#include <stdexcept>

#include <com/sun/star/beans/PropertyValue.hpp>
#include <com/sun/star/beans/PropertyState.hpp>
#include <com/sun/star/frame/XComponentLoader.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/lang/XMultiComponentFactory.hpp>
#include <com/sun/star/uno/XComponentContext.hpp>
#include <com/sun/star/uno/Any.hxx>
#include <com/sun/star/uno/Sequence.hxx>
#include <cppuhelper/bootstrap.hxx>
#include <osl/file.hxx>
#include <rtl/ustring.hxx>

namespace adp {
namespace {

using css::uno::Reference;
using css::uno::UNO_QUERY;

constexpr const char* kEngineVersion = "libreoffice-26.8.2";

css::beans::PropertyValue property(const char* name, css::uno::Any value) {
    css::beans::PropertyValue result;
    result.Name = rtl::OUString::createFromAscii(name);
    result.Handle = -1;
    result.Value = std::move(value);
    result.State = css::beans::PropertyState_DIRECT_VALUE;
    return result;
}

}  // namespace

bool open_document(const std::filesystem::path& source_path,
                   const std::string& format,
                   std::uint64_t source_revision,
                   const std::string& source_content_id,
                   Document& document,
                   std::string& error) {
    close_document(document, error);
    document = Document();
    document.format = format;
    document.source_revision = source_revision;
    document.source_content_id = source_content_id;
    document.source_path = source_path;
    document.source_sha256 = sha256_file(source_path);
    if (document.source_sha256.size() != 64) {
        error = "failed";
        return false;
    }
    try {
        Reference<css::uno::XComponentContext> context =
            cppu::defaultBootstrap_InitialComponentContext();
        if (!context.is()) {
            error = "pack_missing";
            return false;
        }
        Reference<css::lang::XMultiComponentFactory> factory = context->getServiceManager();
        if (!factory.is()) {
            error = "pack_missing";
            return false;
        }
        Reference<css::uno::XInterface> desktop = factory->createInstanceWithContext(
            rtl::OUString::createFromAscii("com.sun.star.frame.Desktop"), context);
        Reference<css::frame::XComponentLoader> loader(desktop, UNO_QUERY);
        if (!loader.is()) {
            error = "failed";
            return false;
        }
        const std::string source_utf8 = source_path.u8string();
        rtl::OUString system_path = rtl::OUString::fromUtf8(source_utf8.c_str());
        rtl::OUString url;
        if (osl::FileBase::getFileURLFromSystemPath(system_path, url) !=
            osl::FileBase::E_None) {
            error = "failed";
            return false;
        }
        css::uno::Sequence<css::beans::PropertyValue> properties(4);
        properties[0] = property("Hidden", css::uno::Any(kLoadHidden));
        properties[1] = property("ReadOnly", css::uno::Any(kLoadReadOnly));
        properties[2] = property("MacroExecutionMode",
                                 css::uno::Any(static_cast<sal_Int16>(kMacroExecutionNever)));
        properties[3] = property("UpdateDocMode",
                                 css::uno::Any(static_cast<sal_Int16>(kUpdateDocNever)));
        auto loaded = loader->loadComponentFromURL(
            url, rtl::OUString::createFromAscii("_blank"), 0, properties);
        if (!loaded.is()) {
            error = "failed";
            return false;
        }
        document.component = loaded;
        document.service_info = Reference<css::lang::XServiceInfo>(loaded, UNO_QUERY);
        document.model = Reference<css::frame::XModel>(loaded, UNO_QUERY);
        document.storable = Reference<css::frame::XStorable>(loaded, UNO_QUERY);
        document.closeable = Reference<css::util::XCloseable>(loaded, UNO_QUERY);
        if (document.model.is()) {
            document.controller = document.model->getCurrentController();
        }
        if (!document.model.is() || !document.storable.is() || !document.closeable.is()) {
            close_document(document, error);
            error = "unsupported";
            return false;
        }
        document.sections = read_sections(document.component, error);
        if (!error.empty() || document.sections.empty() || document.sections.size() > 1'000) {
            close_document(document, error);
            if (error.empty()) error = "failed";
            return false;
        }
        if (!source_hash_unchanged(document)) {
            close_document(document, error);
            error = "changed";
            return false;
        }
        error.clear();
        return true;
    } catch (...) {
        close_document(document, error);
        error = "failed";
        return false;
    }
}

bool close_document(Document& document, std::string& error) {
    try {
        if (document.closeable.is()) {
            document.closeable->close(true);
        }
        error.clear();
    } catch (...) {
        // The actor is terminated by the parent on a hung close. The bridge
        // still drops every reference below.
        error = "failed";
    }
    document.component = nullptr;
    document.service_info = nullptr;
    document.model = nullptr;
    document.controller = nullptr;
    document.storable = nullptr;
    document.closeable = nullptr;
    document.sections.clear();
    return error.empty();
}

bool source_hash_unchanged(const Document& document) {
    const std::string current = sha256_file(document.source_path);
    return current.size() == 64 && current == document.source_sha256;
}

Json document_json(const Document& document) {
    std::map<std::string, Json> root;
    root.emplace("document_id", Json::string_value(document.document_id));
    root.emplace("format", Json::string_value(document.format));
    root.emplace("source_revision",
                 Json::int_value(static_cast<std::int64_t>(document.source_revision)));
    root.emplace("source_content_id",
                 document.source_content_id.empty() ? Json::null()
                                                    : Json::string_value(document.source_content_id));
    root.emplace("engine_version", Json::string_value(kEngineVersion));
    std::vector<Json> sections;
    for (const Section& section : document.sections) {
        std::map<std::string, Json> item;
        item.emplace("id", Json::string_value(section.id));
        item.emplace("name", Json::string_value(section.name));
        item.emplace("kind", Json::string_value(section.kind));
        item.emplace("index", Json::int_value(section.index));
        item.emplace("page_count", Json::int_value(section.page_count));
        if (section.has_grid) {
            item.emplace("rows", Json::int_value(section.rows));
            item.emplace("columns", Json::int_value(section.columns));
        }
        sections.push_back(Json::object_value(std::move(item)));
    }
    root.emplace("sections", Json::array_value(std::move(sections)));
    return Json::object_value(std::move(root));
}

}  // namespace adp
