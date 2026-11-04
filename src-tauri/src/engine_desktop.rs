//! An undisplayed desktop for native Kit's Windows graphics initialization.
//! No switch to this desktop is ever performed; the container receives no
//! switch-desktop, hook-control, journal or ACL-modification rights.

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, HANDLE, HLOCAL, NO_ERROR};
use windows::Win32::Security::Authorization::{
    GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, EXPLICIT_ACCESS_W, GRANT_ACCESS,
    SE_WINDOW_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, DESKTOP_CONTROL_FLAGS, HDESK,
};

pub struct EngineDesktop {
    handle: HDESK,
    path: Vec<u16>,
}

// Windows desktop handles may be used and closed across threads. We never
// associate a parent thread with this desktop through SetThreadDesktop.
unsafe impl Send for EngineDesktop {}

impl EngineDesktop {
    pub fn new(sid: PSID) -> Result<Self, String> {
        let failed = || "engines.sandbox_failed".to_string();
        let name = format!("AdperastraEngine-{}", uuid::Uuid::new_v4());
        let wide: Vec<u16> = name.encode_utf16().chain([0]).collect();
        // Parent owns READ_CONTROL/WRITE_DAC and desktop rights. None of these
        // parent rights is inherited by the AppContainer token.
        let handle = unsafe {
            CreateDesktopW(
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
                None,
                DESKTOP_CONTROL_FLAGS(0),
                0x0006_01ff,
                None,
            )
        }
        .map_err(|_| failed())?;
        let desktop = Self {
            handle,
            path: format!("WinSta0\\{name}")
                .encode_utf16()
                .chain([0])
                .collect(),
        };
        let mut old_acl = std::ptr::null_mut();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        let read = unsafe {
            GetSecurityInfo(
                HANDLE(handle.0),
                SE_WINDOW_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut old_acl),
                None,
                Some(&mut descriptor),
            )
        };
        if read != NO_ERROR {
            return Err(failed());
        }
        let grant = EXPLICIT_ACCESS_W {
            // READOBJECTS, CREATEWINDOW, CREATEMENU, ENUMERATE, WRITEOBJECTS.
            grfAccessPermissions: 0x00c7,
            grfAccessMode: GRANT_ACCESS,
            Trustee: TRUSTEE_W {
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: PWSTR(sid.0.cast()),
                ..Default::default()
            },
            ..Default::default()
        };
        let mut acl = std::ptr::null_mut();
        let merged = unsafe { SetEntriesInAclW(Some(&[grant]), Some(old_acl), &mut acl) };
        unsafe {
            LocalFree(Some(HLOCAL(descriptor.0)));
        }
        if merged != NO_ERROR {
            return Err(failed());
        }
        let written = unsafe {
            SetSecurityInfo(
                HANDLE(handle.0),
                SE_WINDOW_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(acl),
                None,
            )
        };
        unsafe {
            LocalFree(Some(HLOCAL(acl.cast())));
        }
        if written != NO_ERROR {
            return Err(failed());
        }
        Ok(desktop)
    }

    pub fn path(&mut self) -> PWSTR {
        PWSTR(self.path.as_mut_ptr())
    }
}

impl Drop for EngineDesktop {
    fn drop(&mut self) {
        let _ = unsafe { CloseDesktop(self.handle) };
    }
}
