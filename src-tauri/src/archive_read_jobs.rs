//! Credential handling for archive commands (Step 06e T8). Everything here
//! runs before a job starts; no native mutation or job entry exists until
//! the arguments and the password are acceptable.

use std::path::Path;

use crate::archive_passwords::{ArchiveAuth, ArchivePasswords};

/// The password one start command uses: the supplied one, else a remembered
/// one for the same unchanged archive.
pub fn credential_for(
    cache: &ArchivePasswords,
    path: &Path,
    auth: Option<&ArchiveAuth>,
) -> Result<Option<String>, String> {
    match auth {
        Some(auth) => {
            auth.validate()?;
            Ok(Some(auth.password.clone()))
        }
        None => Ok(cache.get(path)),
    }
}

/// Remember only after a verified read; a password failure drops the stale
/// credential and never stores the wrong one.
pub fn note_result(
    cache: &ArchivePasswords,
    path: &Path,
    auth: Option<&ArchiveAuth>,
    password: Option<&str>,
    error: Option<&str>,
) {
    match error {
        Some("archive.bad_password") | Some("archive.password_required") => {
            cache.invalidate(path);
        }
        Some(_) => {}
        None => {
            if let (Some(auth), Some(password)) = (auth, password) {
                if auth.remember_session {
                    let _ = cache.remember(path, password);
                }
            }
        }
    }
}

/// Validate the pieces every start command needs before a job begins.
pub fn validate_start(
    path: &str,
    request_id: &str,
    auth: Option<&ArchiveAuth>,
) -> Result<(), String> {
    crate::valid_request_id(request_id)?;
    crate::validate_absolute_path(path).map_err(|_| "archive.bad_request".to_string())?;
    if let Some(auth) = auth {
        auth.validate()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{credential_for, note_result, validate_start};
    use crate::archive_passwords::{ArchiveAuth, ArchivePasswords};

    fn auth(password: &str, remember: bool) -> ArchiveAuth {
        ArchiveAuth {
            password: password.to_string(),
            remember_session: remember,
        }
    }

    #[test]
    fn old_helper_requests_still_deserialize() {
        use crate::archive_helper::HelperRequest;
        let list: HelperRequest =
            serde_json::from_str(r#"{"op":"list","path":"C:\\a.zip"}"#).unwrap();
        let HelperRequest::List { path, options } = list else {
            panic!("a list request comes back");
        };
        assert_eq!(path, "C:\\a.zip");
        assert!(options.password.is_none());

        let extract: HelperRequest = serde_json::from_str(
            r#"{"op":"extract","path":"C:\\a.zip","request":{"paths":[],"base":"","dest_dir":"C:\\Out","new_folder":null,"expected_size":1,"expected_modified":0,"single_file":false,"zone":null}}"#,
        )
        .unwrap();
        let HelperRequest::Extract { options, .. } = extract else {
            panic!("an extract request comes back");
        };
        assert!(options.password.is_none());
    }

    #[test]
    fn new_command_validation_precedes_job_begin() {
        let invalid = auth("line\nbreak", false);
        assert_eq!(
            validate_start("C:\\a.zip", "arcopen-1-1", Some(&invalid)),
            Err("archive.invalid_password".to_string())
        );
        assert_eq!(
            validate_start("relative.zip", "arcopen-1-1", None),
            Err("archive.bad_request".to_string())
        );
        assert_eq!(
            validate_start("C:\\a.zip", "BAD ID", None),
            Err("archive.bad_request".to_string())
        );
        assert_eq!(validate_start("C:\\a.zip", "arcopen-1-1", None), Ok(()));
    }

    #[test]
    fn remembered_passwords_require_success() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("a.zip");
        std::fs::write(&path, "archive").unwrap();
        let cache = ArchivePasswords::default();

        // A failure never stores the password and drops a stale entry.
        cache.remember(&path, "old").unwrap();
        note_result(
            &cache,
            &path,
            Some(&auth("wrong", true)),
            Some("wrong"),
            Some("archive.bad_password"),
        );
        assert!(cache.get(&path).is_none());

        note_result(&cache, &path, Some(&auth("good", true)), Some("good"), None);
        assert_eq!(cache.get(&path).as_deref(), Some("good"));

        // Not remembering is the default: a successful read keeps nothing.
        let other = folder.path().join("b.zip");
        std::fs::write(&other, "archive").unwrap();
        note_result(
            &cache,
            &other,
            Some(&auth("good", false)),
            Some("good"),
            None,
        );
        assert!(cache.get(&other).is_none());

        // No supplied auth means the cache is consulted, never changed.
        let chosen = credential_for(&cache, &path, None).unwrap();
        assert_eq!(chosen.as_deref(), Some("good"));
    }
}
