# Step 09c: Copy window, "What's using this file?", shelf, and crash recovery (★★★)

**Needs:** 09a. **Builds:** conflict resolver, shelf, crash recovery UI. **Design:** the copy window, conflict window, and shelf aren't in Figma; design them first.

## Tasks
- **A better copy window** for every copy and move job: pause and resume; speed and time remaining; skip or retry individual files after errors instead of failing the whole job, with a list of problems at the end; an optional "Verify copies" setting that checks each copied file matches the original (by hash); a queue so several big copies to the same drive run one after another instead of slowing each other down.
- **Conflict window:** when a file already exists, show both files side by side with a thumbnail or preview, size, and date, and choose Replace, Skip, Keep both (auto-renamed), or "Replace if newer", with "Do this for all remaining conflicts". Everything stays undoable.
- **"What's using this file?":** when a delete, move, rename, or save fails because a file is in use, show which programs have it open (Windows Restart Manager API), with "Close program" (asks the program to close normally, so it can save) and "Retry". Also a right-click command "What's using this?" for files and folders. Never force-close a program without a second confirmation, and never touch system processes.
- **Shelf:** a small, dockable holding area (toggle from the title bar or Ctrl+Shift+S) where I drop files and folders from any tab or folder to collect them without moving them yet. From the shelf: move or copy all to a folder, compress, share, convert, privacy clean, send to the assistant (Step 17a), or open as a tab group. Items show thumbnails and their original location; the shelf survives restarts until cleared; items moved or deleted elsewhere are marked. Drag items out of the shelf to anywhere, including other apps.
- **Crash recovery and "Report a problem":** if one file tab crashes, the Explorer keeps running and offers "Reload tab"; if the whole app crashes, the next start offers "Restore your tabs" (including groups, split views, and unsaved changes from autosave). Help > "Report a problem" builds a diagnostics zip (app version, Windows version, hardware summary, recent logs, crash dump) that I can review and edit before saving; it never uploads anything, and masks file paths and user names by default. It then opens a pre-filled GitHub issue form where I can attach it. If the app crashes three times in a row at startup, it starts in safe mode (no packs, default settings) and says so.

## Help pages
Copying and conflicts; files in use; the shelf; recovering after a crash; reporting a problem.

## Done when
I can pause and resume a big copy, resolve conflicts with previews, find and close the program locking a file, collect files on the shelf and move them together, and recover my tabs after a forced crash.
