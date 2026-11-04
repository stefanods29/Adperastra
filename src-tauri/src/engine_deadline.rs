//! A deadline that also interrupts a blocked pipe write to a confined job.
use std::{
    os::windows::io::{AsRawHandle, BorrowedHandle},
    sync::mpsc,
    time::Duration,
};
use windows::Win32::{Foundation::HANDLE, System::JobObjects::TerminateJobObject};

pub struct EngineDeadline {
    cancel: mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<bool>>,
}

impl EngineDeadline {
    pub fn finish(mut self) -> bool {
        let _ = self.cancel.send(());
        self.thread
            .take()
            .is_some_and(|thread| thread.join().unwrap_or(true))
    }
}

impl Drop for EngineDeadline {
    fn drop(&mut self) {
        let _ = self.cancel.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn arm(job: HANDLE, timeout: Duration) -> Result<EngineDeadline, String> {
    // SAFETY: called only with the live job owned by ConfinedProcess. Clone
    // immediately; the watchdog owns its independent kernel reference.
    let owned = unsafe { BorrowedHandle::borrow_raw(job.0) }
        .try_clone_to_owned()
        .map_err(|_| "office_edit.failed".to_owned())?;
    let (cancel, receiver) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        if receiver.recv_timeout(timeout).is_err() {
            // SAFETY: this thread retains the owned job handle until exit.
            unsafe {
                let _ = TerminateJobObject(HANDLE(owned.as_raw_handle()), 1);
            }
            true
        } else {
            false
        }
    });
    Ok(EngineDeadline {
        cancel,
        thread: Some(thread),
    })
}
