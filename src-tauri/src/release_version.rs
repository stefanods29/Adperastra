//! Release versions (Step 08d E1): SemVer parsing and precedence.
//!
//! The parser is deliberately strict: numeric components have no leading
//! zeros, u32 overflow is refused, and prerelease/build text is ASCII and
//! bounded. Build metadata never changes precedence. No display text is
//! produced here; callers map the returned codes to their own messages.

use std::cmp::Ordering;
use std::fmt;

/// Longest accepted version string, including prerelease and build text.
pub const MAX_VERSION_CHARS: usize = 128;
/// Longest accepted prerelease text.
pub const MAX_PRERELEASE_CHARS: usize = 64;
/// Longest accepted build text.
pub const MAX_BUILD_CHARS: usize = 64;

/// A parsed semantic version (E1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub prerelease: Option<String>,
    pub build: Option<String>,
}

impl ReleaseVersion {
    /// Parses `MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`.
    ///
    /// Error codes: `version.empty`, `version.too_long`, `version.invalid`,
    /// `version.leading_zero`, `version.overflow`.
    pub fn parse(input: &str) -> Result<Self, &'static str> {
        let text = input.trim();
        if text.is_empty() {
            return Err("version.empty");
        }
        if text.chars().count() > MAX_VERSION_CHARS {
            return Err("version.too_long");
        }
        if !text.is_ascii() || text.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("version.invalid");
        }

        let (without_build, build) = match text.split_once('+') {
            Some((left, right)) => (left, Some(right)),
            None => (text, None),
        };
        let (core, prerelease) = match without_build.split_once('-') {
            Some((left, right)) => (left, Some(right)),
            None => (without_build, None),
        };

        let mut parts = core.split('.');
        let major = parse_numeric(parts.next(), false)?;
        let minor = parse_numeric(parts.next(), false)?;
        let patch = parse_numeric(parts.next(), false)?;
        if parts.next().is_some() {
            return Err("version.invalid");
        }

        let prerelease = match prerelease {
            Some(value) => {
                check_text(value, MAX_PRERELEASE_CHARS)?;
                for identifier in value.split('.') {
                    check_identifier(identifier)?;
                    if identifier.chars().all(|c| c.is_ascii_digit())
                        && identifier.len() > 1
                        && identifier.starts_with('0')
                    {
                        return Err("version.leading_zero");
                    }
                }
                Some(value.to_string())
            }
            None => None,
        };

        let build = match build {
            Some(value) => {
                check_text(value, MAX_BUILD_CHARS)?;
                for identifier in value.split('.') {
                    check_identifier(identifier)?;
                }
                Some(value.to_string())
            }
            None => None,
        };

        Ok(Self {
            major,
            minor,
            patch,
            prerelease,
            build,
        })
    }

    /// Parses a tag such as `v0.1.0` or `refs/tags/v0.1.0`.
    pub fn parse_tag(tag: &str) -> Result<Self, &'static str> {
        let trimmed = tag.trim();
        let without_ref = trimmed.strip_prefix("refs/tags/").unwrap_or(trimmed);
        let without_v = without_ref
            .strip_prefix('v')
            .or_else(|| without_ref.strip_prefix('V'))
            .unwrap_or(without_ref);
        Self::parse(without_v)
    }

    /// SemVer precedence; build metadata is ignored.
    pub fn compare_precedence(&self, other: &Self) -> Ordering {
        self.major
            .cmp(&other.major)
            .then_with(|| self.minor.cmp(&other.minor))
            .then_with(|| self.patch.cmp(&other.patch))
            .then_with(|| match (&self.prerelease, &other.prerelease) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(left), Some(right)) => compare_prerelease(left, right),
            })
    }

    /// True when this version has a higher precedence than `other`.
    pub fn is_newer_than(&self, other: &Self) -> bool {
        self.compare_precedence(other) == Ordering::Greater
    }
}

impl fmt::Display for ReleaseVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if let Some(prerelease) = &self.prerelease {
            write!(formatter, "-{prerelease}")?;
        }
        if let Some(build) = &self.build {
            write!(formatter, "+{build}")?;
        }
        Ok(())
    }
}

fn parse_numeric(value: Option<&str>, allow_leading_zero: bool) -> Result<u32, &'static str> {
    let text = value.ok_or("version.invalid")?;
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit()) {
        return Err("version.invalid");
    }
    if !allow_leading_zero && text.len() > 1 && text.starts_with('0') {
        return Err("version.leading_zero");
    }
    text.parse::<u32>().map_err(|_| "version.overflow")
}

fn check_text(value: &str, max_chars: usize) -> Result<(), &'static str> {
    if value.is_empty() || value.chars().count() > max_chars {
        return Err("version.invalid");
    }
    Ok(())
}

fn check_identifier(identifier: &str) -> Result<(), &'static str> {
    if identifier.is_empty()
        || !identifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("version.invalid");
    }
    Ok(())
}

fn compare_prerelease(left: &str, right: &str) -> Ordering {
    let mut left_parts = left.split('.');
    let mut right_parts = right.split('.');
    loop {
        match (left_parts.next(), right_parts.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left), Some(right)) => {
                let left_numeric = left.chars().all(|c| c.is_ascii_digit());
                let right_numeric = right.chars().all(|c| c.is_ascii_digit());
                let ordering = match (left_numeric, right_numeric) {
                    (true, true) => left.len().cmp(&right.len()).then_with(|| left.cmp(right)),
                    (true, false) => Ordering::Less,
                    (false, true) => Ordering::Greater,
                    (false, false) => left.cmp(right),
                };
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_versions() {
        let version = ReleaseVersion::parse("0.1.0").unwrap();
        assert_eq!(
            version,
            ReleaseVersion {
                major: 0,
                minor: 1,
                patch: 0,
                prerelease: None,
                build: None,
            }
        );
        assert_eq!(version.to_string(), "0.1.0");
        assert_eq!(
            ReleaseVersion::parse_tag("refs/tags/v1.2.3").unwrap().to_string(),
            "1.2.3"
        );
        assert_eq!(
            ReleaseVersion::parse("1.2.3-beta.2+build.7").unwrap().to_string(),
            "1.2.3-beta.2+build.7"
        );
    }

    #[test]
    fn rejects_leading_zero_numeric_components() {
        for bad in ["01.2.3", "1.02.3", "1.2.03", "1.2.3-01"] {
            assert_eq!(
                ReleaseVersion::parse(bad),
                Err("version.leading_zero"),
                "{bad}"
            );
        }
        assert!(ReleaseVersion::parse("0.0.0").is_ok());
        assert!(ReleaseVersion::parse("1.2.3-0a").is_ok());
    }

    #[test]
    fn rejects_overflow_and_bad_shapes() {
        assert_eq!(
            ReleaseVersion::parse("4294967296.0.0"),
            Err("version.overflow")
        );
        for bad in [
            "",
            "1",
            "1.2",
            "1.2.3.4",
            "1..3",
            "1.2.3-",
            "1.2.3+",
            "1.2.3-a..b",
            "1.2.3-á",
            "1.2.3 build",
        ] {
            assert!(
                ReleaseVersion::parse(bad).is_err(),
                "{bad} should be refused"
            );
        }
        let too_long = format!("1.2.3-{}", "a".repeat(MAX_PRERELEASE_CHARS + 1));
        assert!(ReleaseVersion::parse(&too_long).is_err());
    }

    #[test]
    fn compares_semver_numerically() {
        let older = ReleaseVersion::parse("1.9.0").unwrap();
        let newer = ReleaseVersion::parse("1.10.0").unwrap();
        assert!(newer.is_newer_than(&older));
        assert!(!older.is_newer_than(&newer));

        let release = ReleaseVersion::parse("1.0.0").unwrap();
        let prerelease = ReleaseVersion::parse("1.0.0-rc.1").unwrap();
        assert!(release.is_newer_than(&prerelease));
        assert_eq!(
            ReleaseVersion::parse("1.0.0-alpha.2")
                .unwrap()
                .compare_precedence(&ReleaseVersion::parse("1.0.0-alpha.10").unwrap()),
            Ordering::Less
        );
        assert_eq!(
            ReleaseVersion::parse("1.0.0-alpha")
                .unwrap()
                .compare_precedence(&ReleaseVersion::parse("1.0.0-alpha.1").unwrap()),
            Ordering::Less
        );
        assert_eq!(
            ReleaseVersion::parse("1.0.0-1")
                .unwrap()
                .compare_precedence(&ReleaseVersion::parse("1.0.0-alpha").unwrap()),
            Ordering::Less
        );
    }

    #[test]
    fn build_metadata_never_changes_precedence() {
        let left = ReleaseVersion::parse("1.0.0+001").unwrap();
        let right = ReleaseVersion::parse("1.0.0+999").unwrap();
        assert_eq!(left.compare_precedence(&right), Ordering::Equal);
        assert!(!left.is_newer_than(&right));
    }
}
