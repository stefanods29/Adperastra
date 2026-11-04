#include "sections.hxx"

#include <algorithm>
#include <sstream>

#include <com/sun/star/container/XEnumeration.hpp>
#include <com/sun/star/container/XEnumerationAccess.hpp>
#include <com/sun/star/container/XIndexAccess.hpp>
#include <com/sun/star/container/XNamed.hpp>
#include <com/sun/star/drawing/XDrawPage.hpp>
#include <com/sun/star/drawing/XDrawPages.hpp>
#include <com/sun/star/drawing/XDrawPagesSupplier.hpp>
#include <com/sun/star/frame/XController.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/lang/XServiceInfo.hpp>
#include <com/sun/star/table/XColumnRowRange.hpp>
#include <com/sun/star/table/XTableColumns.hpp>
#include <com/sun/star/table/XTableRows.hpp>
#include <com/sun/star/sheet/XSpreadsheet.hpp>
#include <com/sun/star/sheet/XSpreadsheets.hpp>
#include <com/sun/star/sheet/XSpreadsheetDocument.hpp>
#include <com/sun/star/text/XPageCursor.hpp>
#include <com/sun/star/text/XTextViewCursor.hpp>
#include <com/sun/star/text/XTextViewCursorSupplier.hpp>
#include <com/sun/star/uno/Any.hxx>
#include <com/sun/star/uno/Reference.hxx>
#include <rtl/ustring.hxx>
#include <rtl/string.hxx>
#include <rtl/textenc.h>

namespace adp {
namespace {

using css::uno::Reference;
using css::uno::UNO_QUERY;

template <typename T>
std::string name_of(const Reference<T>& object) {
    Reference<css::container::XNamed> named(object, UNO_QUERY);
    if (!named.is()) return {};
    try {
        const auto value = rtl::OUStringToOString(named->getName(), RTL_TEXTENCODING_UTF8);
        return std::string(value.getStr(), static_cast<std::size_t>(value.getLength()));
    } catch (...) {
        return {};
    }
}

std::uint32_t text_page_count(const Reference<css::lang::XComponent>& component) {
    Reference<css::frame::XModel> model(component, UNO_QUERY);
    if (!model.is()) return 1;
    try {
        Reference<css::frame::XController> controller = model->getCurrentController();
        Reference<css::text::XTextViewCursorSupplier> supplier(controller, UNO_QUERY);
        if (!supplier.is()) return 1;
        Reference<css::text::XPageCursor> cursor(supplier->getViewCursor(), UNO_QUERY);
        if (!cursor.is()) return 1;
        cursor->jumpToLastPage();
        const sal_Int32 page = cursor->getPage();
        return page > 0 ? std::min<std::uint32_t>(10'000, static_cast<std::uint32_t>(page)) : 1;
    } catch (...) {
        return 1;
    }
}

}  // namespace

std::vector<Section> read_sections(const Reference<css::lang::XComponent>& component,
                                   std::string& error) {
    std::vector<Section> sections;
    if (!component.is()) {
        error = "failed";
        return sections;
    }
    Reference<css::lang::XServiceInfo> info(component, UNO_QUERY);
    Reference<css::frame::XModel> model(component, UNO_QUERY);
    if (!model.is()) {
        error = "unsupported";
        return sections;
    }
    const bool is_text = info.is() && info->supportsService(
                                             rtl::OUString::createFromAscii(
                                                 "com.sun.star.text.TextDocument"));
    const bool is_sheet = info.is() && info->supportsService(
                                              rtl::OUString::createFromAscii(
                                                  "com.sun.star.sheet.SpreadsheetDocument"));
    const bool is_deck = info.is() && info->supportsService(
                                             rtl::OUString::createFromAscii(
                                                 "com.sun.star.presentation.PresentationDocument"));
    if (is_text) {
        sections.push_back(Section{
            "document",
            "",
            "document",
            0,
            text_page_count(component),
            false,
            0,
            0,
        });
        return sections;
    }
    if (is_sheet) {
        Reference<css::sheet::XSpreadsheetDocument> supplier(model, UNO_QUERY);
        if (!supplier.is()) {
            error = "unsupported";
            return sections;
        }
        try {
            Reference<css::sheet::XSpreadsheets> sheets = supplier->getSheets();
            Reference<css::container::XEnumerationAccess> access(sheets, UNO_QUERY);
            if (!access.is()) {
                error = "unsupported";
                return {};
            }
            Reference<css::container::XEnumeration> enumeration = access->createEnumeration();
            std::uint32_t index = 0;
            while (enumeration->hasMoreElements() && index < 1'000) {
                css::uno::Any item = enumeration->nextElement();
                Reference<css::sheet::XSpreadsheet> sheet;
                item >>= sheet;
                if (!sheet.is()) {
                    error = "unsupported";
                    return {};
                }
                Section section;
                section.id = "sheet:" + std::to_string(index);
                section.name = name_of(sheet);
                section.kind = "sheet";
                section.index = index;
                section.page_count = 1;
                section.has_grid = true;
                try {
                    Reference<css::table::XColumnRowRange> dimensions(sheet, UNO_QUERY);
                    if (!dimensions.is()) {
                        error = "unsupported";
                        return {};
                    }
                    section.rows = static_cast<std::uint32_t>(dimensions->getRows()->getCount());
                    section.columns = static_cast<std::uint32_t>(dimensions->getColumns()->getCount());
                } catch (...) {
                    error = "failed";
                    return {};
                }
                sections.push_back(std::move(section));
                ++index;
            }
            error.clear();
            return sections;
        } catch (...) {
            error = "unsupported";
            return {};
        }
    }
    if (is_deck) {
        Reference<css::drawing::XDrawPagesSupplier> supplier(model, UNO_QUERY);
        if (!supplier.is()) {
            error = "unsupported";
            return {};
        }
        try {
            Reference<css::drawing::XDrawPages> pages = supplier->getDrawPages();
            const sal_Int32 count = pages->getCount();
            if (count < 0 || count > 1'000) {
                error = "failed";
                return {};
            }
            for (sal_Int32 index = 0; index < count; ++index) {
                css::uno::Any page_any = pages->getByIndex(index);
                Reference<css::drawing::XDrawPage> page;
                page_any >>= page;
                Section section;
                section.id = "slide:" + std::to_string(index);
                section.name = name_of(page);
                section.kind = "slide";
                section.index = static_cast<std::uint32_t>(index);
                section.page_count = 1;
                sections.push_back(std::move(section));
            }
            error.clear();
            return sections;
        } catch (...) {
            error = "unsupported";
            return {};
        }
    }
    error = "unsupported";
    return sections;
}

std::string section_filename(const Section& section) {
    std::ostringstream name;
    name << "section_" << section.index << ".pdf";
    return name.str();
}

}  // namespace adp
