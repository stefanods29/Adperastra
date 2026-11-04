// Stable section descriptors for the office_read_v1 bridge.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include <com/sun/star/lang/XComponent.hpp>
#include <com/sun/star/uno/Reference.hxx>

namespace adp {

struct Section {
    std::string id;
    std::string name;
    std::string kind;  // document | sheet | slide
    std::uint32_t index = 0;
    std::uint32_t page_count = 1;
    bool has_grid = false;
    std::uint32_t rows = 0;
    std::uint32_t columns = 0;
};

std::vector<Section> read_sections(
    const css::uno::Reference<css::lang::XComponent>& component,
    std::string& error);

std::string section_filename(const Section& section);

}  // namespace adp
