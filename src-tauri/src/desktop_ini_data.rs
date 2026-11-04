//! Bounded lossless decoding only. Existing desktop.ini replacement remains
//! unavailable; parsing never grants ownership of any section or entry.
#![allow(dead_code)]


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopIniEncoding { Utf8, Utf8Bom, Utf16Le }

#[derive(Debug, Clone)]
pub struct DesktopIniData {
    original: Vec<u8>,
    text: String,
    pub encoding: DesktopIniEncoding,
}

impl DesktopIniData {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 64 * 1024 { return Err("folder_custom.limit".into()); }
        let (text, encoding) = if bytes.starts_with(&[0xff, 0xfe]) {
            if !bytes.len().is_multiple_of(2) { return Err("folder_custom.invalid".into()); }
            let units: Vec<u16> = bytes[2..].as_chunks::<2>().0.iter()
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
            (String::from_utf16(&units).map_err(|_| "folder_custom.invalid")?, DesktopIniEncoding::Utf16Le)
        } else {
            let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
            let source = if bom { &bytes[3..] } else { bytes };
            (std::str::from_utf8(source).map_err(|_| "folder_custom.invalid")?.to_owned(),
                if bom { DesktopIniEncoding::Utf8Bom } else { DesktopIniEncoding::Utf8 })
        };
        if text.contains('\0') { return Err("folder_custom.invalid".into()); }
        Ok(Self { original: bytes.to_vec(), text, encoding })
    }

    /// Exact retained bytes, including BOM, comments, unknown keys and newlines.
    pub fn original_bytes(&self) -> &[u8] { &self.original }

    /// Inspection only. Duplicate keys remain visible to conflict review;
    /// this is not a last-key-wins rewrite that discards unknown data.
    pub fn shell_entries(&self) -> Vec<(&str, &str)> {
        let mut shell = false;
        let mut values = Vec::new();
        for line in self.text.lines() {
            let line = line.trim();
            if line.starts_with(';') || line.starts_with('#') { continue; }
            if line.starts_with('[') && line.ends_with(']') {
                shell = line[1..line.len() - 1].trim().eq_ignore_ascii_case(".ShellClassInfo");
            } else if shell {
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    if key.eq_ignore_ascii_case("IconResource") || key.eq_ignore_ascii_case("InfoTip") {
                        values.push((key, value.trim()));
                    }
                }
            }
        }
        values
    }

    /// Encoding only, not filesystem authorization. Before calling, the native
    /// writer must validate that icon_resource is its own published icon file.
    pub fn new_file(icon_resource: &str, info_tip: Option<&str>) -> Result<Vec<u8>, String> {
        if icon_resource.is_empty() || icon_resource.encode_utf16().count() > 32768 ||
            icon_resource.contains(['\r', '\n', '\0']) ||
            info_tip.is_some_and(|value| value.chars().count() > 1024 || value.contains(['\r', '\n', '\0'])) {
            return Err("folder_custom.invalid".into());
        }
        let mut text = format!("[.ShellClassInfo]\r\nIconResource={icon_resource},0\r\n");
        if let Some(value) = info_tip { text.push_str(&format!("InfoTip={value}\r\n")); }
        let mut bytes = vec![0xff, 0xfe];
        for unit in text.encode_utf16() { bytes.extend_from_slice(&unit.to_le_bytes()); }
        if bytes.len() > 64 * 1024 { return Err("folder_custom.limit".into()); }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_ini_keys_preserved() {
        let bytes = b";keep\r\n[Unknown]\r\nx=y\r\n[.ShellClassInfo]\r\nOther=keep\r\nInfoTip=old\r\n";
        let parsed = DesktopIniData::parse(bytes).unwrap();
        assert_eq!(parsed.original_bytes(), bytes);
        assert_eq!(parsed.shell_entries(), vec![("InfoTip", "old")]);
    }
    #[test]
    fn new_file_is_unicode_and_has_only_owned_fields() {
        let bytes = DesktopIniData::new_file(r"C:\Profile\icons\owned.ico", Some("Folder")).unwrap();
        assert_eq!(&bytes[..2], &[0xff, 0xfe]);
        let parsed = DesktopIniData::parse(&bytes).unwrap();
        assert_eq!(parsed.shell_entries(), vec![("IconResource", r"C:\Profile\icons\owned.ico,0"), ("InfoTip", "Folder")]);
    }
    #[test]
    fn malformed_and_oversized_data_refused() {
        assert!(DesktopIniData::parse(&vec![b'a'; 65537]).is_err());
        assert!(DesktopIniData::parse(&[0xff, 0xfe, 1]).is_err());
        assert!(DesktopIniData::parse(&[0xff, 0xfe, 0x00, 0xd8]).is_err());
        assert!(DesktopIniData::new_file("icon\r\nEvil=x", None).is_err());
    }
}
