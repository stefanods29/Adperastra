use crate::types::*;
use fs_service::SourceStamp;
use regex::{Regex, RegexBuilder};
use std::collections::{BTreeSet, HashSet};
use std::path::{Component, Path};

pub type RenameResult<T> = Result<T, String>;
fn bad<T>() -> RenameResult<T> {
    Err("rename.bad_request".into())
}
fn bounded(text: &str, max: usize) -> RenameResult<()> {
    if text.chars().count() > max {
        return bad();
    }
    Ok(())
}

/// A source path the executor may pin: absolute Windows path, not a root,
/// no relative components and no trailing separator. The returned key is the
/// fs-service normalized identity key used for duplicates and stamp matching.
pub(crate) fn source_path_key(path: &str) -> RenameResult<String> {
    fs_service::validate_path_input(path).map_err(|_| "rename.bad_request")?;
    if path.ends_with('\\') || path.ends_with('/') {
        return bad();
    }
    let native = Path::new(path);
    if native.parent().is_none() || native.file_name().is_none() {
        return bad();
    }
    if native
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return bad();
    }
    fs_service::path_key_of(native).map_err(|_| "rename.bad_request".to_owned())
}

/// Bind a native stamp to the path it is supposed to describe. fs-service owns
/// the field rules; the path key is normalized here so an uppercase drive letter
/// from a caller cannot pass as a different source.
pub(crate) fn validate_source_stamp(stamp: &SourceStamp, path: &str) -> RenameResult<()> {
    let key = source_path_key(path)?;
    let stamp_key = fs_service::path_key_of(Path::new(&stamp.path_key))
        .map_err(|_| "rename.bad_request".to_owned())?;
    if stamp_key != key {
        return bad();
    }
    let mut normalized = stamp.clone();
    normalized.path_key = key;
    normalized
        .validate()
        .map_err(|_| "rename.bad_request".to_owned())
}

/// Renaming a parent while one of its descendants is also a source would move
/// the descendant behind its pinned handle. The native guard must refuse it;
/// the pure planner refuses it before a plan is offered.
pub(crate) fn source_keys_overlap(keys: &[String]) -> bool {
    for (index, key) in keys.iter().enumerate() {
        for other in &keys[index + 1..] {
            if is_ancestor_key(key, other) || is_ancestor_key(other, key) {
                return true;
            }
        }
    }
    false
}
fn is_ancestor_key(parent: &str, child: &str) -> bool {
    let prefix = if parent.ends_with('\\') {
        parent.to_owned()
    } else {
        format!("{parent}\\")
    };
    child.starts_with(&prefix)
}

/// Already formatted dates belong to the plan's captured UTC/local zone.
/// Only requested metadata fields are fetched by the native provider.
#[derive(Debug, Default, Clone)]
pub struct TemplateValues {
    pub date_modified: Option<String>,
    pub date_taken: Option<String>,
    pub camera_model: Option<String>,
    pub width: Option<String>,
    pub height: Option<String>,
}

pub fn validate_request(request: &RenameRequest) -> RenameResult<()> {
    if request.paths.is_empty() || request.paths.len() > MAX_SOURCES {
        return Err("rename.too_large".into());
    }
    let mut source_keys = HashSet::new();
    let mut ordered_keys = Vec::with_capacity(request.paths.len());
    for path in &request.paths {
        let key = source_path_key(path)?;
        if !source_keys.insert(key.clone()) {
            return bad();
        }
        ordered_keys.push(key);
    }
    if source_keys_overlap(&ordered_keys) {
        return bad();
    }
    let mut excluded = HashSet::new();
    for &index in &request.excluded_indices {
        if index as usize >= request.paths.len() || !excluded.insert(index) {
            return bad();
        }
    }
    validate_operations(&request.operations)?;
    if let Some(RenameOperation::ExplicitNames { names }) = request.operations.first() {
        if request.operations.len() != 1 || request.include_extension {
            return bad();
        }
        let expected: Vec<_> = (0..request.paths.len() as u32)
            .filter(|i| !excluded.contains(i))
            .collect();
        if names
            .iter()
            .map(|entry| entry.input_index)
            .collect::<Vec<_>>()
            != expected
        {
            return bad();
        }
    }
    if serde_json::to_vec(request)
        .map_err(|_| "rename.bad_request")?
        .len()
        > MAX_PLAN_BYTES
    {
        return Err("rename.too_large".into());
    }
    Ok(())
}

pub fn validate_operations(operations: &[RenameOperation]) -> RenameResult<()> {
    if operations.is_empty() || operations.len() > 32 {
        return bad();
    }
    for operation in operations {
        match operation {
            RenameOperation::Replace {
                find,
                replacement,
                regex,
                match_case,
            } => {
                bounded(find, 4096)?;
                bounded(replacement, 4096)?;
                if *regex {
                    compile(find, *match_case, replacement)?;
                }
            }
            RenameOperation::Prefix { text } | RenameOperation::Suffix { text } => {
                bounded(text, 4096)?
            }
            RenameOperation::Number {
                start,
                step,
                padding,
                separator,
                ..
            } => {
                if *start > 1_000_000
                    || !(1..=1_000_000).contains(step)
                    || !(1..=12).contains(padding)
                {
                    return bad();
                }
                bounded(separator, 16)?;
            }
            RenameOperation::Template { pattern } => bounded(pattern, 512)?,
            RenameOperation::Remove { characters } => bounded(characters, 256)?,
            RenameOperation::Case { .. } => (),
            RenameOperation::ExplicitNames { names } => {
                if operations.len() != 1 || names.len() > MAX_SOURCES {
                    return bad();
                }
                let mut indices = HashSet::new();
                for entry in names {
                    if !indices.insert(entry.input_index)
                        || entry.new_name.is_empty()
                        || entry.new_name.encode_utf16().count() > 255
                    {
                        return bad();
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn validate_preset(preset: &RenamePreset) -> RenameResult<()> {
    if preset.version != 1
        || preset.id.is_nil()
        || preset.name.trim().is_empty()
        || preset.name.chars().count() > 60
    {
        return bad();
    }
    if preset
        .operations
        .iter()
        .any(|op| matches!(op, RenameOperation::ExplicitNames { .. }))
    {
        return bad();
    }
    validate_operations(&preset.operations)
}

fn compile(pattern: &str, match_case: bool, replacement: &str) -> RenameResult<Regex> {
    if pattern.len() > 4096 {
        return Err("rename.regex".into());
    }
    let regex = RegexBuilder::new(pattern)
        .case_insensitive(!match_case)
        .size_limit(1024 * 1024)
        .dfa_size_limit(1024 * 1024)
        .build()
        .map_err(|_| "rename.regex")?;
    // Parse the same replacement grammar used below, including capture bounds.
    expand_replacement(replacement, regex.captures_len(), |_| Some(String::new()))?;
    Ok(regex)
}

fn expand_replacement(
    text: &str,
    captures: usize,
    value: impl Fn(usize) -> Option<String>,
) -> RenameResult<String> {
    let mut result = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '$' {
            result.push(ch);
            continue;
        }
        if chars.peek() == Some(&'$') {
            chars.next();
            result.push('$');
            continue;
        }
        let braced = chars.peek() == Some(&'{');
        if braced {
            chars.next();
        }
        let mut digits = String::new();
        while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
            digits.push(chars.next().expect("peeked digit"));
        }
        if digits.is_empty() || (braced && chars.next() != Some('}')) {
            return Err("rename.regex".into());
        }
        let index = digits.parse::<usize>().map_err(|_| "rename.regex")?;
        if index >= captures {
            return Err("rename.regex".into());
        }
        if let Some(value) = value(index) {
            result.push_str(&value);
        }
    }
    Ok(result)
}

fn push_bounded(out: &mut String, part: &str) -> RenameResult<()> {
    if out
        .len()
        .checked_add(part.len())
        .is_none_or(|len| len > MAX_PLAN_BYTES)
    {
        return Err("rename.too_large".into());
    }
    out.push_str(part);
    Ok(())
}

fn replace(
    text: &str,
    find: &str,
    replacement: &str,
    is_regex: bool,
    match_case: bool,
) -> RenameResult<String> {
    // Literal replacement is never interpreted as a capture expression.
    let regex = if is_regex {
        compile(find, match_case, replacement)?
    } else {
        RegexBuilder::new(&regex::escape(find))
            .case_insensitive(!match_case)
            .size_limit(1024 * 1024)
            .dfa_size_limit(1024 * 1024)
            .build()
            .map_err(|_| "rename.regex")?
    };
    let mut result = String::new();
    let mut end = 0;
    for captures in regex.captures_iter(text) {
        let found = captures.get(0).expect("full match");
        push_bounded(&mut result, &text[end..found.start()])?;
        if is_regex {
            let expansion = expand_replacement(replacement, regex.captures_len(), |index| {
                captures.get(index).map(|m| m.as_str().to_owned())
            })?;
            push_bounded(&mut result, &expansion)?;
        } else {
            push_bounded(&mut result, replacement)?;
        }
        end = found.end();
    }
    push_bounded(&mut result, &text[end..])?;
    Ok(result)
}

fn parts(name: &str, is_directory: bool) -> (&str, &str) {
    if !is_directory {
        if let Some(index) = name.rfind('.') {
            if index > 0 {
                return (&name[..index], &name[index..]);
            }
        }
    }
    (name, "")
}
fn normalize_metadata(text: &str) -> String {
    let mut result = String::new();
    for ch in text.chars() {
        let ch = if ch.is_control() || "<>:\"/\\|?*".contains(ch) {
            '_'
        } else {
            ch
        };
        if ch != '_' || !result.ends_with('_') {
            result.push(ch);
        }
    }
    result.trim_end_matches(['.', ' ']).to_owned()
}

/// Template tokens are parsed once. Metadata containing braces is inert text.
pub fn requested_metadata(operations: &[RenameOperation]) -> BTreeSet<&'static str> {
    let mut fields = BTreeSet::new();
    for op in operations {
        if let RenameOperation::Template { pattern } = op {
            for field in ["date_taken", "camera_model", "width", "height"] {
                if pattern.contains(&format!("{{{field}}}")) {
                    fields.insert(field);
                }
            }
        }
    }
    fields
}
fn template(
    pattern: &str,
    stem: &str,
    ext: &str,
    index: u32,
    values: &TemplateValues,
) -> RenameResult<String> {
    let mut result = String::new();
    let mut rest = pattern;
    while let Some(open) = rest.find('{') {
        if rest[..open].contains('}') {
            return bad();
        }
        push_bounded(&mut result, &rest[..open])?;
        rest = &rest[open + 1..];
        let close = rest.find('}').ok_or("rename.bad_request")?;
        let token = &rest[..close];
        let value = match token {
            "stem" => stem.to_owned(),
            "ext" => ext.trim_start_matches('.').to_owned(),
            "index" => index.to_string(),
            "date_modified" => normalize_metadata(
                values
                    .date_modified
                    .as_deref()
                    .ok_or("rename.metadata_missing")?,
            ),
            "date_taken" => normalize_metadata(
                values
                    .date_taken
                    .as_deref()
                    .ok_or("rename.metadata_missing")?,
            ),
            "camera_model" => normalize_metadata(
                values
                    .camera_model
                    .as_deref()
                    .ok_or("rename.metadata_missing")?,
            ),
            "width" => {
                normalize_metadata(values.width.as_deref().ok_or("rename.metadata_missing")?)
            }
            "height" => {
                normalize_metadata(values.height.as_deref().ok_or("rename.metadata_missing")?)
            }
            _ => return bad(),
        };
        push_bounded(&mut result, &value)?;
        rest = &rest[close + 1..];
    }
    if rest.contains('}') {
        return bad();
    }
    push_bounded(&mut result, rest)?;
    Ok(result)
}

/// `included_index` is derived from original order, never from a paged viewport.
pub fn transform_name(
    request: &RenameRequest,
    input_index: u32,
    original: &str,
    is_directory: bool,
    values: &TemplateValues,
) -> RenameResult<String> {
    let candidate = transform_candidate(request, input_index, original, is_directory, values)?;
    if !request.excluded_indices.contains(&input_index) {
        fs_service::validate_new_name(&candidate).map_err(|_| "rename.invalid_name")?;
    }
    Ok(candidate)
}

/// Keep the proposed invalid component visible in preview; never use it as
/// mutation authority. Only the validated plan/handle pipeline may execute.
pub(crate) fn transform_candidate(
    request: &RenameRequest,
    input_index: u32,
    original: &str,
    is_directory: bool,
    values: &TemplateValues,
) -> RenameResult<String> {
    if input_index as usize >= request.paths.len() {
        return bad();
    }
    if request.excluded_indices.contains(&input_index) {
        return Ok(original.to_owned());
    }
    if let Some(RenameOperation::ExplicitNames { names }) = request.operations.first() {
        let name = &names
            .iter()
            .find(|entry| entry.input_index == input_index)
            .ok_or("rename.bad_request")?
            .new_name;
        return Ok(name.clone());
    }
    let ordinal = (0..input_index)
        .filter(|i| !request.excluded_indices.contains(i))
        .count() as u32;
    let (stem, extension) = parts(original, is_directory);
    let mut current = if request.include_extension {
        original
    } else {
        stem
    }
    .to_owned();
    for operation in &request.operations {
        current = match operation {
            RenameOperation::Prefix { text } => {
                let mut out = text.clone();
                push_bounded(&mut out, &current)?;
                out
            }
            RenameOperation::Suffix { text } => {
                push_bounded(&mut current, text)?;
                current
            }
            RenameOperation::Replace {
                find,
                replacement,
                regex,
                match_case,
            } => replace(&current, find, replacement, *regex, *match_case)?,
            RenameOperation::Number {
                start,
                step,
                padding,
                position,
                separator,
            } => {
                let n = ordinal
                    .checked_mul(*step)
                    .and_then(|n| start.checked_add(n))
                    .ok_or("rename.invalid_name")?;
                let number = format!("{n:0width$}", width = *padding as usize);
                let out = match position {
                    NumberPosition::Prefix => format!("{number}{separator}{current}"),
                    NumberPosition::Suffix => format!("{current}{separator}{number}"),
                };
                if out.len() > MAX_PLAN_BYTES {
                    return Err("rename.too_large".into());
                }
                out
            }
            RenameOperation::Case { mode } => match mode {
                CaseMode::Lower => current.to_lowercase(),
                CaseMode::Upper => current.to_uppercase(),
                CaseMode::Title => {
                    let mut beginning = true;
                    let mut out = String::new();
                    for ch in current.chars() {
                        if ch.is_whitespace() || ch == '-' || ch == '_' {
                            out.push(ch);
                            beginning = true;
                        } else {
                            if beginning {
                                out.extend(ch.to_uppercase());
                            } else {
                                out.extend(ch.to_lowercase());
                            }
                            beginning = false;
                        }
                    }
                    out
                }
            },
            RenameOperation::Template { pattern } => {
                template(pattern, &current, extension, ordinal + 1, values)?
            }
            RenameOperation::Remove { characters } => current
                .chars()
                .filter(|ch| !characters.contains(*ch))
                .collect(),
            RenameOperation::ExplicitNames { .. } => return bad(),
        };
        if current.len() > MAX_PLAN_BYTES {
            return Err("rename.too_large".into());
        }
    }
    if !request.include_extension {
        push_bounded(&mut current, extension)?;
    }
    Ok(current)
}
