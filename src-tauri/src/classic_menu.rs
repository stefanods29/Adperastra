//! "Show more options" (Step 03a): the classic Windows context menu, with
//! every shell extension the user has installed, shown by a separate
//! process (this executable started with `--classic-menu`). Shell
//! extensions are third-party code, so running them outside the app means
//! a slow or crashing extension can never freeze or crash Adperastra; the
//! app waits a few seconds for the menu and then gives up.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

pub const HELPER_FLAG: &str = "--classic-menu";
/// Printed by the helper right before its menu appears.
pub const READY_LINE: &str = "ready";
/// How long the classic menu may take to load before the app gives up.
pub const LOAD_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_ITEMS: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MenuRequest {
    pub paths: Vec<String>,
    /// The folder's own menu (right-click on empty space); `paths` holds
    /// the folder.
    pub background: bool,
    /// Screen position in physical pixels.
    pub x: i32,
    pub y: i32,
}

/// A request the helper will act on: one to MAX_ITEMS paths, and exactly
/// one (the folder) for the folder's own menu.
pub fn is_valid_request(request: &MenuRequest) -> bool {
    !request.paths.is_empty()
        && request.paths.len() <= MAX_ITEMS
        && (!request.background || request.paths.len() == 1)
}

#[derive(Debug, PartialEq, Eq)]
pub enum WaitOutcome {
    Ready,
    Exited,
    TimedOut,
}

/// Wait for the helper's ready line. On timeout the helper is killed, so a
/// hung shell extension cannot keep running in the background.
pub fn wait_until_ready(child: &mut Child, timeout: Duration) -> WaitOutcome {
    let Some(stdout) = child.stdout.take() else {
        return WaitOutcome::Exited;
    };
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let ready =
            BufReader::new(stdout).read_line(&mut line).is_ok() && line.trim() == READY_LINE;
        let _ = sender.send(ready);
    });
    match receiver.recv_timeout(timeout) {
        Ok(true) => WaitOutcome::Ready,
        Ok(false) => WaitOutcome::Exited,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            WaitOutcome::TimedOut
        }
    }
}

/// Start the helper for `request` and return once its menu is on screen.
/// Errors are `moreOptions.<reason>` codes the UI translates.
pub fn show(request: &MenuRequest) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "moreOptions.failed".to_string())?;
    let mut child = Command::new(exe)
        .arg(HELPER_FLAG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "moreOptions.failed".to_string())?;
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
        // SAFETY: plain Win32 call; lets the helper bring its menu to the
        // front, as the app itself is the foreground window.
        let _ = unsafe { AllowSetForegroundWindow(child.id()) };
    }
    let request_json = serde_json::to_vec(request).map_err(|_| "moreOptions.failed".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        if stdin.write_all(&request_json).is_err() {
            let _ = child.kill();
            return Err("moreOptions.failed".to_string());
        }
    }
    match wait_until_ready(&mut child, LOAD_TIMEOUT) {
        WaitOutcome::Ready => {
            // The menu (and anything it opens) now lives on its own.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        WaitOutcome::Exited => {
            let _ = child.wait();
            Err("moreOptions.failed".to_string())
        }
        WaitOutcome::TimedOut => Err("moreOptions.timeout".to_string()),
    }
}

/// Entry point of the helper process: read the request from stdin, show
/// the menu, run the chosen command, and stay alive while a window it
/// opened (for example Properties) is still open. Returns the exit code.
pub fn run_helper() -> i32 {
    let mut input = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).is_err() {
        return 2;
    }
    let Ok(request) = serde_json::from_str::<MenuRequest>(&input) else {
        return 2;
    };
    if !is_valid_request(&request) {
        return 2;
    }
    #[cfg(windows)]
    {
        // SAFETY: the helper owns this process; everything below runs on
        // its single thread.
        match unsafe { helper::run(&request) } {
            Ok(()) => 0,
            Err(_) => 1,
        }
    }
    #[cfg(not(windows))]
    {
        1
    }
}

#[cfg(windows)]
mod helper {
    use super::{MenuRequest, READY_LINE};
    use std::cell::RefCell;
    use std::io::Write;
    use std::path::Path;
    use std::time::{Duration, Instant};
    use windows::core::{w, Interface, PCSTR, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        IContextMenu, IContextMenu2, IContextMenu3, ILFindLastID, ILFree, IShellFolder,
        SHBindToObject, SHBindToParent, SHParseDisplayName, CMF_NORMAL, CMIC_MASK_PTINVOKE,
        CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
        DispatchMessageW, EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
        MsgWaitForMultipleObjects, PeekMessageW, PostMessageW, RegisterClassW, SetForegroundWindow,
        TrackPopupMenuEx, TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT, SW_SHOWNORMAL,
        TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR,
        WM_NULL, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
    };

    /// Not in the generated bindings: lpVerbW/lpDirectoryW are valid.
    const CMIC_MASK_UNICODE: u32 = 0x0000_4000;

    thread_local! {
        static MENU: RefCell<Option<IContextMenu>> = const { RefCell::new(None) };
    }

    /// Owner-drawn items (Send to, Open with, icons) are drawn by the
    /// extensions themselves through these messages.
    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if matches!(
            msg,
            WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR
        ) {
            let handled = MENU.with(|slot| {
                let menu = slot.borrow();
                let menu = menu.as_ref()?;
                if let Ok(menu3) = menu.cast::<IContextMenu3>() {
                    let mut result = LRESULT(0);
                    // SAFETY: forwarding a menu message to the extension that owns the menu.
                    if unsafe { menu3.HandleMenuMsg2(msg, wparam, lparam, Some(&mut result)) }
                        .is_ok()
                    {
                        return Some(result);
                    }
                } else if let Ok(menu2) = menu.cast::<IContextMenu2>() {
                    // SAFETY: as above, for older extensions.
                    if unsafe { menu2.HandleMenuMsg(msg, wparam, lparam) }.is_ok() {
                        return Some(LRESULT(0));
                    }
                }
                None
            });
            if let Some(result) = handled {
                return result;
            }
        }
        // SAFETY: default handling for every other message.
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    struct Pidls(Vec<*mut ITEMIDLIST>);
    impl Drop for Pidls {
        fn drop(&mut self) {
            for pidl in &self.0 {
                // SAFETY: each PIDL came from SHParseDisplayName and is freed once.
                unsafe { ILFree(Some(*pidl as *const ITEMIDLIST)) };
            }
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn parse(path: &str) -> windows::core::Result<*mut ITEMIDLIST> {
        let text = wide(path);
        let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
        // SAFETY: `text` outlives the call; the caller frees the PIDL.
        unsafe { SHParseDisplayName(PCWSTR(text.as_ptr()), None, &mut pidl, 0, None) }?;
        Ok(pidl)
    }

    /// The menu for selected items. Items must share one folder (a Home
    /// list can mix folders), so only those in the first item's folder are
    /// included.
    unsafe fn item_menu(owner: HWND, paths: &[String]) -> windows::core::Result<IContextMenu> {
        let parent_of = |path: &str| {
            Path::new(path)
                .parent()
                .map(|p| p.to_string_lossy().to_lowercase())
        };
        let first_parent = parent_of(&paths[0]);
        let mut pidls = Pidls(Vec::new());
        for path in paths.iter().filter(|p| parent_of(p) == first_parent) {
            // SAFETY: freed by `pidls`.
            pidls.0.push(unsafe { parse(path) }?);
        }
        // SAFETY: the first PIDL is valid; the folder interface is owned.
        let folder: IShellFolder = unsafe { SHBindToParent(pidls.0[0], None) }?;
        // SAFETY: the last IDs point into PIDLs that outlive the call.
        let children: Vec<*const ITEMIDLIST> = pidls
            .0
            .iter()
            .map(|pidl| unsafe { ILFindLastID(*pidl) } as *const ITEMIDLIST)
            .collect();
        // SAFETY: children are relative to `folder`, as required.
        unsafe { folder.GetUIObjectOf(owner, &children, None) }
    }

    /// The folder's own menu (empty space).
    unsafe fn background_menu(
        owner: HWND,
        folder_path: &str,
    ) -> windows::core::Result<IContextMenu> {
        // SAFETY: freed by the guard.
        let pidl = Pidls(vec![unsafe { parse(folder_path) }?]);
        // SAFETY: binding the folder's own PIDL from the desktop.
        let folder: IShellFolder = unsafe { SHBindToObject(None, pidl.0[0], None) }?;
        // SAFETY: owner window is ours.
        unsafe { folder.CreateViewObject(owner) }
    }

    /// True while this process shows a visible window other than `own`
    /// (for example a Properties sheet opened from the menu).
    unsafe fn has_visible_windows(own: HWND) -> bool {
        struct Search {
            own: HWND,
            pid: u32,
            found: bool,
        }
        unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
            // SAFETY: lparam points at the Search below for the whole enumeration.
            let search = unsafe { &mut *(lparam.0 as *mut Search) };
            let mut pid = 0u32;
            // SAFETY: plain Win32 queries on a window handle from EnumWindows.
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            if pid == search.pid && hwnd != search.own && unsafe { IsWindowVisible(hwnd) }.as_bool()
            {
                search.found = true;
                return false.into();
            }
            true.into()
        }
        let mut search = Search {
            own,
            pid: std::process::id(),
            found: false,
        };
        // SAFETY: `search` outlives the enumeration.
        let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
        search.found
    }

    /// Keep pumping messages while anything the command opened is still on
    /// screen; leave three seconds after the last window closes.
    unsafe fn wait_for_opened_windows(own: HWND) {
        let started = Instant::now();
        let mut last_seen = Instant::now();
        loop {
            let mut msg = MSG::default();
            // SAFETY: standard message pump for this thread.
            while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
                unsafe {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            if unsafe { has_visible_windows(own) } {
                last_seen = Instant::now();
            }
            if (started.elapsed() > Duration::from_secs(3)
                && last_seen.elapsed() > Duration::from_secs(3))
                || started.elapsed() > Duration::from_secs(4 * 60 * 60)
            {
                break;
            }
            // SAFETY: waits for messages or 250 ms.
            unsafe { MsgWaitForMultipleObjects(None, false, 250, QS_ALLINPUT) };
        }
    }

    pub unsafe fn run(request: &MenuRequest) -> windows::core::Result<()> {
        // SAFETY: OLE for this thread (clipboard verbs such as Copy need it).
        unsafe { OleInitialize(None) }?;
        let result = unsafe { show_and_invoke(request) };
        MENU.with(|slot| slot.borrow_mut().take());
        // SAFETY: pairs with OleInitialize above.
        unsafe { OleUninitialize() };
        result
    }

    unsafe fn show_and_invoke(request: &MenuRequest) -> windows::core::Result<()> {
        // SAFETY: registering and creating this process's own hidden window.
        let instance = unsafe { GetModuleHandleW(None) }?;
        let class_name = w!("AdperastraClassicMenu");
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };
        unsafe { RegisterClassW(&class) };
        let owner = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                class_name,
                w!(""),
                WS_POPUP,
                request.x,
                request.y,
                1,
                1,
                None,
                None,
                Some(instance.into()),
                None,
            )
        }?;

        #[cfg(debug_assertions)]
        if let Some(ms) = std::env::var("ADPERASTRA_CLASSIC_MENU_TEST_DELAY_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
        {
            // Test hook (debug builds only): behave like a slow extension.
            std::thread::sleep(Duration::from_millis(ms));
        }

        let menu = if request.background {
            unsafe { background_menu(owner, &request.paths[0]) }
        } else {
            unsafe { item_menu(owner, &request.paths) }
        }?;
        let popup = unsafe { CreatePopupMenu() }?;
        // SAFETY: the extensions add their items to our popup menu.
        unsafe { menu.QueryContextMenu(popup, 0, 1, 0x7FFF, CMF_NORMAL) }.ok()?;
        MENU.with(|slot| *slot.borrow_mut() = Some(menu.clone()));

        let mut stdout = std::io::stdout();
        let _ = writeln!(stdout, "{READY_LINE}");
        let _ = stdout.flush();

        // SAFETY: standard TrackPopupMenu pattern: the owner must be in the
        // foreground, and WM_NULL afterwards lets the menu close cleanly.
        let chosen = unsafe {
            let _ = SetForegroundWindow(owner);
            let chosen = TrackPopupMenuEx(
                popup,
                (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
                request.x,
                request.y,
                owner,
                None,
            );
            let _ = PostMessageW(Some(owner), WM_NULL, WPARAM(0), LPARAM(0));
            chosen.0
        };
        if chosen > 0 {
            let verb = (chosen - 1) as usize;
            let info = CMINVOKECOMMANDINFOEX {
                cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
                fMask: CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE,
                hwnd: owner,
                // MAKEINTRESOURCE: the verb is the item's offset.
                lpVerb: PCSTR(verb as *const u8),
                lpVerbW: PCWSTR(verb as *const u16),
                nShow: SW_SHOWNORMAL.0,
                ptInvoke: POINT {
                    x: request.x,
                    y: request.y,
                },
                ..Default::default()
            };
            // SAFETY: `info` is a valid CMINVOKECOMMANDINFOEX for this menu.
            let invoked = unsafe {
                menu.InvokeCommand(
                    &info as *const CMINVOKECOMMANDINFOEX as *const CMINVOKECOMMANDINFO,
                )
            };
            if invoked.is_ok() {
                unsafe { wait_for_opened_windows(owner) };
            }
        }
        unsafe {
            let _ = DestroyMenu(popup);
            let _ = DestroyWindow(owner);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{wait_until_ready, WaitOutcome, READY_LINE};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    fn powershell(script: &str) -> std::process::Child {
        Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("powershell starts")
    }

    #[test]
    fn a_helper_that_never_gets_ready_is_killed_after_the_timeout() {
        let mut child = powershell("Start-Sleep -Seconds 30");
        let started = Instant::now();
        assert_eq!(
            wait_until_ready(&mut child, Duration::from_millis(400)),
            WaitOutcome::TimedOut
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(
            child.try_wait().expect("status").is_some(),
            "the helper was killed"
        );
    }

    #[test]
    fn a_ready_helper_is_detected_and_a_crash_is_reported() {
        let mut ready = powershell(&format!(
            "Write-Output '{READY_LINE}'; Start-Sleep -Seconds 1"
        ));
        assert_eq!(
            wait_until_ready(&mut ready, Duration::from_secs(20)),
            WaitOutcome::Ready
        );
        let _ = ready.kill();
        let mut crashed = powershell("exit 3");
        assert_eq!(
            wait_until_ready(&mut crashed, Duration::from_secs(20)),
            WaitOutcome::Exited
        );
    }

    #[test]
    fn the_helper_accepts_only_sensible_requests() {
        let request = |count: usize, background: bool| super::MenuRequest {
            paths: (0..count).map(|i| format!("C:\\f{i}")).collect(),
            background,
            x: 10,
            y: 20,
        };
        assert!(super::is_valid_request(&request(1, false)));
        assert!(super::is_valid_request(&request(3, false)));
        assert!(super::is_valid_request(&request(1, true)));
        assert!(!super::is_valid_request(&request(0, false)));
        assert!(!super::is_valid_request(&request(2, true)));
        assert!(!super::is_valid_request(&request(
            super::MAX_ITEMS + 1,
            false
        )));
        // The request survives the trip through stdin as JSON.
        let json = serde_json::to_string(&request(2, false)).unwrap();
        assert_eq!(
            serde_json::from_str::<super::MenuRequest>(&json).unwrap(),
            request(2, false)
        );
    }
}
