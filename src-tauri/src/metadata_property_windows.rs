//! Windows-only PROPVARIANT reading. Every variant returned by
//! `IPropertyStore::GetValue` is owned by the caller and must be cleared
//! through `PropVariantClear`, which `VariantGuard` does exactly once.

use super::{filetime_to_iso8601, value_for_values, values_for_text, PropertyRead};
use crate::metadata_types::{MetadataFieldId, MAX_LIST_ENTRIES, MAX_TEXT_CHARS};
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, CALPWSTR, PROPVARIANT};
use windows::Win32::System::Variant::{
    VT_BSTR, VT_EMPTY, VT_FILETIME, VT_I1, VT_I2, VT_I4, VT_I8, VT_LPWSTR, VT_NULL, VT_R4, VT_R8,
    VT_UI1, VT_UI2, VT_UI4, VT_UI8, VT_VECTOR,
};
use windows::Win32::UI::Shell::PropertiesSystem::{
    IPropertyStore, PSGetPropertyKeyFromName, SHGetPropertyStoreFromParsingName, GPS_DEFAULT,
};

/// The most vector entries inspected before the list is truncated.
const MAX_VECTOR_READ: u32 = (MAX_LIST_ENTRIES as u32) + 1;
/// The largest string read from one property.
const MAX_READ_CHARS: usize = MAX_TEXT_CHARS + 1;

/// Owns one returned PROPVARIANT and clears it exactly once.
pub struct VariantGuard(PROPVARIANT);

impl VariantGuard {
    pub fn new(variant: PROPVARIANT) -> Self {
        Self(variant)
    }

    pub fn value(&self) -> &PROPVARIANT {
        &self.0
    }
}

impl Drop for VariantGuard {
    fn drop(&mut self) {
        // SAFETY: the variant was returned by GetValue and has not been
        // cleared anywhere else; PropVariantClear accepts VT_EMPTY too.
        unsafe {
            let _ = PropVariantClear(&mut self.0);
        }
    }
}

/// A Win32 path with the `\\?\` prefix for long paths.
fn long_path_wide(path: &Path) -> Vec<u16> {
    let text = path.to_string_lossy().into_owned();
    let prefixed = if text.starts_with(r"\\?\") || text.starts_with(r"\\.\") {
        text
    } else {
        let text = text.replace('/', "\\");
        if let Some(unc) = text.strip_prefix(r"\\") {
            format!(r"\\?\UNC\{unc}")
        } else if text.len() >= 2 && text.as_bytes()[1] == b':' {
            format!(r"\\?\{text}")
        } else {
            text
        }
    };
    prefixed.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Resolve the fixed allowlist to property keys once per store. Names
/// Windows does not know are skipped, never guessed.
pub fn resolve_keys() -> Vec<(MetadataFieldId, PROPERTYKEY)> {
    let mut keys = Vec::new();
    for spec in super::PROPERTY_SPECS {
        let wide: Vec<u16> = spec
            .canonical_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut key = PROPERTYKEY::default();
        // SAFETY: `wide` is a NUL-terminated name and `key` is writable.
        let found = unsafe { PSGetPropertyKeyFromName(PCWSTR(wide.as_ptr()), &mut key) };
        if found.is_ok() {
            keys.push((spec.field, key));
        }
    }
    keys
}

/// Open the Windows property store read-only (`GPS_DEFAULT`, no write
/// or temporary flags). The caller owns COM initialization.
pub fn open_store(path: &Path) -> Result<IPropertyStore, String> {
    let wide = long_path_wide(path);
    // SAFETY: `wide` is a NUL-terminated absolute path; the store is
    // released by the returned interface, never written through.
    unsafe {
        SHGetPropertyStoreFromParsingName::<_, _, IPropertyStore>(
            PCWSTR(wide.as_ptr()),
            None,
            GPS_DEFAULT,
        )
    }
    .map_err(|_| "metadata.failed".to_string())
}

fn vt_of(variant: &PROPVARIANT) -> u16 {
    // SAFETY: the union's first member is the initialized variant header
    // for every value the property system returns.
    unsafe { variant.Anonymous.Anonymous.vt.0 }
}

fn string_of(pointer: windows::core::PWSTR) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    // SAFETY: the property system owns this NUL-terminated allocation until
    // VariantGuard drops. Stop at a fixed UTF-16 bound before allocating.
    let mut units = Vec::new();
    for index in 0..=(MAX_READ_CHARS * 2) {
        let unit = unsafe { *pointer.0.add(index) };
        if unit == 0 {
            let text = String::from_utf16(&units).ok()?;
            return (text.chars().count() <= MAX_TEXT_CHARS).then_some(text);
        }
        units.push(unit);
    }
    None
}

fn vector_strings(variant: &PROPVARIANT) -> Vec<String> {
    // SAFETY: the caller checked the variant kind is VT_VECTOR|VT_LPWSTR.
    let list: CALPWSTR = unsafe { variant.Anonymous.Anonymous.Anonymous.calpwstr };
    if list.pElems.is_null() || list.cElems == 0 {
        return Vec::new();
    }
    let count = list.cElems.min(MAX_VECTOR_READ);
    let mut out = Vec::with_capacity(count as usize);
    for index in 0..count {
        // SAFETY: count is bounded by the declared element count.
        let pointer = unsafe { *list.pElems.add(index as usize) };
        if let Some(text) = string_of(pointer) {
            out.push(text);
        }
    }
    out
}

fn unsigned_of(variant: &PROPVARIANT) -> Option<u64> {
    let vt = vt_of(variant);
    // SAFETY: each arm reads only the union member selected by `vt`.
    unsafe {
        match vt {
            value if value == VT_UI1.0 => Some(variant.Anonymous.Anonymous.Anonymous.bVal as u64),
            value if value == VT_UI2.0 => Some(variant.Anonymous.Anonymous.Anonymous.uiVal as u64),
            value if value == VT_UI4.0 => Some(variant.Anonymous.Anonymous.Anonymous.ulVal as u64),
            value if value == VT_UI8.0 => Some(variant.Anonymous.Anonymous.Anonymous.uhVal),
            value if value == VT_I1.0 => {
                let number = variant.Anonymous.Anonymous.Anonymous.cVal;
                (number >= 0).then_some(number as u64)
            }
            value if value == VT_I2.0 => {
                let number = variant.Anonymous.Anonymous.Anonymous.iVal;
                (number >= 0).then_some(number as u64)
            }
            value if value == VT_I4.0 => {
                let number = variant.Anonymous.Anonymous.Anonymous.lVal;
                (number >= 0).then_some(number as u64)
            }
            value if value == VT_I8.0 => {
                let number = variant.Anonymous.Anonymous.Anonymous.hVal;
                (number >= 0).then_some(number as u64)
            }
            value if value == VT_FILETIME.0 => {
                let filetime = variant.Anonymous.Anonymous.Anonymous.filetime;
                Some(((filetime.dwHighDateTime as u64) << 32) | filetime.dwLowDateTime as u64)
            }
            _ => None,
        }
    }
}

fn decimal_of(variant: &PROPVARIANT) -> Option<f64> {
    let vt = vt_of(variant);
    // SAFETY: each arm reads only the union member selected by `vt`.
    unsafe {
        match vt {
            value if value == VT_UI4.0 => Some(variant.Anonymous.Anonymous.Anonymous.ulVal as f64),
            value if value == VT_R4.0 => Some(variant.Anonymous.Anonymous.Anonymous.fltVal as f64),
            value if value == VT_R8.0 => Some(variant.Anonymous.Anonymous.Anonymous.dblVal),
            _ => None,
        }
    }
}

/// GetValue transfers ownership; exactly one guard clears each variant.
pub fn read_value(
    store: &IPropertyStore,
    field: MetadataFieldId,
    key: &PROPERTYKEY,
) -> PropertyRead {
    // SAFETY: key comes from the static allowlist, store is local COM.
    let variant = match unsafe { store.GetValue(key) } {
        Ok(value) => value,
        Err(_) => return PropertyRead::Invalid,
    };
    let guard = VariantGuard::new(variant);
    let vt = vt_of(guard.value());
    if vt == VT_EMPTY.0 || vt == VT_NULL.0 {
        return PropertyRead::Absent;
    }
    let list_field = matches!(
        field,
        MetadataFieldId::AudioArtist | MetadataFieldId::Author
    );
    let mut values = Vec::new();
    let mut integer = None;
    let mut decimal = None;
    let mut truncated = false;
    if vt == VT_LPWSTR.0 {
        // SAFETY: the variant tag selects pwszVal; guard owns its lifetime.
        let Some(text) = string_of(unsafe { guard.value().Anonymous.Anonymous.Anonymous.pwszVal })
        else {
            return PropertyRead::Invalid;
        };
        values = values_for_text(field, &text);
        truncated = values.len() > MAX_LIST_ENTRIES;
    } else if vt == (VT_VECTOR.0 | VT_LPWSTR.0) && list_field {
        values = vector_strings(guard.value());
        // SAFETY: matching vector tag above selects calpwstr.
        let count = unsafe { guard.value().Anonymous.Anonymous.Anonymous.calpwstr.cElems } as usize;
        truncated = count > MAX_LIST_ENTRIES || count.min(MAX_LIST_ENTRIES + 1) > values.len();
    } else if vt == VT_BSTR.0 {
        return PropertyRead::Invalid;
    } else {
        integer = unsigned_of(guard.value());
        decimal = matches!(vt, 4 | 5)
            .then(|| decimal_of(guard.value()))
            .flatten();
    }
    if field == MetadataFieldId::DateTaken {
        if vt != VT_FILETIME.0 {
            return PropertyRead::Invalid;
        }
        if let Some(date) = integer.and_then(filetime_to_iso8601) {
            values.push(date);
        }
    }
    match value_for_values(field, values, integer, decimal) {
        Some(value) if truncated => PropertyRead::Partial(value),
        Some(value) => PropertyRead::Value(value),
        None => PropertyRead::Invalid,
    }
}
