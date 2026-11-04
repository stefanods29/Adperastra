//! Profile descriptors and the bounded profile catalog (Step 10c T4,
//! profile-root-1).
//!
//! `profiles.json` has schema 1, at most 20 profiles and one `default`
//! profile whose folder is the legacy base. The catalog never stores a
//! user-controlled root or any path; roots are resolved from the portable
//! location plus a validated id.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const PROFILE_CATALOG_SCHEMA: u32 = 1;
pub const MAX_PROFILES: usize = 20;
pub const MAX_PROFILE_NAME: usize = 60;
pub const DEFAULT_PROFILE_ID: &str = "default";
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileDescriptor {
    /// `default` or a canonical lower-case UUID.
    pub id: String,
    /// 1 to 60 Unicode scalar values; stored trimmed.
    pub name: String,
    pub created_unix: u64,
    pub modified_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileCatalog {
    pub schema_version: u32,
    pub active_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_id: Option<String>,
    pub profiles: Vec<ProfileDescriptor>,
    pub revision: u64,
}

impl ProfileCatalog {
    /// The catalog a fresh data folder starts with.
    pub fn new(now_unix: u64) -> Self {
        Self {
            schema_version: PROFILE_CATALOG_SCHEMA,
            active_id: DEFAULT_PROFILE_ID.to_string(),
            pending_id: None,
            profiles: vec![ProfileDescriptor {
                id: DEFAULT_PROFILE_ID.to_string(),
                name: "Default".to_string(),
                created_unix: now_unix,
                modified_unix: now_unix,
            }],
            revision: 1,
        }
    }
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// A canonical lower-case, hyphenated UUID.
pub fn is_canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|parsed| parsed.hyphenated().to_string() == value)
        .unwrap_or(false)
}

pub fn is_valid_profile_id(value: &str) -> bool {
    value == DEFAULT_PROFILE_ID || is_canonical_uuid(value)
}

/// Trimmed name of 1 to 60 Unicode scalar values, or None.
pub fn normalize_profile_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let length = trimmed.chars().count();
    if length == 0 || length > MAX_PROFILE_NAME {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn valid_timestamp(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

/// Full catalog validation; a newer schema is refused without rewriting it.
pub fn validate_catalog(catalog: &ProfileCatalog) -> Result<(), String> {
    if catalog.schema_version != PROFILE_CATALOG_SCHEMA {
        return Err("profiles.invalid".to_string());
    }
    if catalog.revision == 0 || !valid_timestamp(catalog.revision) {
        return Err("profiles.invalid".to_string());
    }
    if catalog.profiles.is_empty() || catalog.profiles.len() > MAX_PROFILES {
        return Err("profiles.invalid".to_string());
    }
    let mut ids = BTreeSet::new();
    let mut defaults = 0usize;
    for profile in &catalog.profiles {
        if !is_valid_profile_id(&profile.id) || !ids.insert(profile.id.as_str()) {
            return Err("profiles.invalid".to_string());
        }
        if profile.id == DEFAULT_PROFILE_ID {
            defaults += 1;
        }
        if normalize_profile_name(&profile.name).as_deref() != Some(profile.name.as_str()) {
            return Err("profiles.invalid".to_string());
        }
        if !valid_timestamp(profile.created_unix) || !valid_timestamp(profile.modified_unix) {
            return Err("profiles.invalid".to_string());
        }
    }
    if defaults != 1 {
        return Err("profiles.invalid".to_string());
    }
    if !ids.contains(catalog.active_id.as_str()) {
        return Err("profiles.invalid".to_string());
    }
    if let Some(pending) = catalog.pending_id.as_deref() {
        if !ids.contains(pending) {
            return Err("profiles.invalid".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_catalog_has_one_default_profile() {
        let catalog = ProfileCatalog::new(10);
        assert_eq!(catalog.schema_version, 1);
        assert_eq!(catalog.active_id, "default");
        assert_eq!(catalog.profiles.len(), 1);
        assert_eq!(catalog.revision, 1);
        assert!(validate_catalog(&catalog).is_ok());
    }

    #[test]
    fn names_are_trimmed_and_bounded() {
        assert_eq!(normalize_profile_name("  Work  "), Some("Work".to_string()));
        assert_eq!(normalize_profile_name("   "), None);
        assert_eq!(normalize_profile_name(&"x".repeat(61)), None);
        assert!(normalize_profile_name(&"x".repeat(60)).is_some());
    }

    #[test]
    fn refuses_duplicate_ids_and_twenty_one_profiles() {
        let mut catalog = ProfileCatalog::new(10);
        let duplicate = catalog.profiles[0].clone();
        catalog.profiles.push(duplicate);
        assert!(validate_catalog(&catalog).is_err());

        let mut catalog = ProfileCatalog::new(10);
        for _ in 0..19 {
            catalog.profiles.push(ProfileDescriptor {
                id: Uuid::new_v4().to_string(),
                name: "Extra".to_string(),
                created_unix: 1,
                modified_unix: 1,
            });
        }
        assert!(validate_catalog(&catalog).is_ok());
        catalog.profiles.push(ProfileDescriptor {
            id: Uuid::new_v4().to_string(),
            name: "One too many".to_string(),
            created_unix: 1,
            modified_unix: 1,
        });
        assert!(validate_catalog(&catalog).is_err());
    }

    #[test]
    fn refuses_a_newer_schema_and_unknown_fields() {
        let mut catalog = ProfileCatalog::new(10);
        catalog.schema_version = 2;
        assert!(validate_catalog(&catalog).is_err());

        let raw = r#"{"schema_version":1,"active_id":"default","revision":1,
            "profiles":[{"id":"default","name":"Default","created_unix":1,"modified_unix":1,
            "data_dir":"C:\\elsewhere"}]}"#;
        assert!(serde_json::from_str::<ProfileCatalog>(raw).is_err());
    }
}
