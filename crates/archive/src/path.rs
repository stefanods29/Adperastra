//! Inner paths of an archive (Step 06d D7, plan/rules.md R-FS-3 and
//! R-SEC-8). Every raw name from a format goes through `normalize_inner_path`
//! before it is listed, so an entry can never write outside the folder the
//! user chose.

use crate::limits::Limits;

/// `docs//a.txt` to `docs/a.txt`, and a refusal for anything that a Windows
/// folder cannot hold or that would leave the destination folder.
///
/// The error is the skip reason: `unsafe_path` (absolute, a drive letter,
/// a `..` component) or `invalid_name` (nothing left, too long, too deep,
/// a name Windows refuses).
pub fn normalize_inner_path(raw: &str, limits: &Limits) -> Result<String, &'static str> {
    let slashed = raw.replace('\\', "/");
    if slashed.starts_with('/') {
        return Err("unsafe_path");
    }
    let mut characters = slashed.chars();
    let _first = characters.next();
    if characters.next() == Some(':') {
        return Err("unsafe_path");
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in slashed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err("unsafe_path");
        }
        parts.push(part);
    }
    if parts.is_empty() || parts.len() > limits.max_depth {
        return Err("invalid_name");
    }
    let joined = parts.join("/");
    if joined.chars().count() > limits.max_inner_path_chars {
        return Err("invalid_name");
    }
    for part in &parts {
        if fs_service::validate_new_name(part).is_err() {
            return Err("invalid_name");
        }
    }
    Ok(joined)
}

/// True for the root markers some tools write (`./`, `/`, `.`): they are
/// left out of a listing without a note (bsdtar writes `./`).
pub fn is_root_entry(raw: &str) -> bool {
    let slashed = raw.replace('\\', "/");
    !slashed.is_empty() && slashed.chars().all(|c| c == '/' || c == '.')
}

/// The text before the last `/`, or "" at the root.
pub fn parent_of(inner: &str) -> &str {
    match inner.rfind('/') {
        Some(slash) => &inner[..slash],
        None => "",
    }
}

/// The text after the last `/`.
pub fn name_of(inner: &str) -> &str {
    match inner.rfind('/') {
        Some(slash) => &inner[slash + 1..],
        None => inner,
    }
}

/// `inner` below `base`, or `None` when it is not below it (or is the base
/// itself). A base of "" holds the whole path.
pub fn relative_to<'a>(inner: &'a str, base: &str) -> Option<&'a str> {
    if base.is_empty() {
        return Some(inner);
    }
    let rest = inner.strip_prefix(base)?;
    rest.strip_prefix('/')
}

/// The first component of a relative path.
pub fn first_component(relative: &str) -> &str {
    match relative.find('/') {
        Some(slash) => &relative[..slash],
        None => relative,
    }
}
