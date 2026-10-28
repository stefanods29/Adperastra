# Known issues

Every defect, deferral, and speed miss is recorded here instead of being
silently forgotten or quietly relaxed. Severity rules are in
`plan/rules.md` section 11 and in `AGENTS.md` section 4.

Each entry: ID, severity, the step where it was found, a plain-language
description, any workaround, and the target step or milestone for the fix.
When an issue is fixed, move it to the **Fixed** section with the commit
that fixed it.

## Open

### KI-001 - First-ever run takes about 2.2 seconds (Minor)
- **Found in:** Step 01b. **Severity:** Minor (one-time cost).
- **What:** The very first launch creates the WebView2 profile and takes
  about 2.2 s to show the window on the development PC. The startup
  skeleton (built into the first page) is shown as soon as the window
  paints. Every later start is fast (see KI-002/KI-003).
- **Workaround:** none needed; it happens once.
- **Target:** reviewed at every milestone; no fix planned unless the
  after-reboot measurement (KI-003) shows a wider problem.

### KI-002 - First start after installing or rebuilding takes about 1.6 s to first paint (Minor)
- **Found in:** Step 01b. **Severity:** Minor (one-time cost per install).
- **What:** The first execution of a freshly installed or rebuilt
  executable pays Windows Defender scanning and cold file caches: about
  1.6 s to first paint and 2.4 s until fully ready in the worst measured
  run. Normal cold starts (WebView2 stopped, caches warm) measure 87 ms
  first paint / 699 ms ready, inside the Fast tier.
- **Workaround:** none; start the app once after installing.
- **Target:** reviewed at every milestone.

### KI-003 - Cold start right after a reboot is not yet measured (Major)
- **Found in:** Step 01b. **Severity:** Major until measured (a daily-use
  speed miss cannot be ruled out yet).
- **What:** All cold numbers so far were measured without rebooting the
  PC, so cold operating-system caches after a real reboot are unproven.
- **Workaround / next action:** the owner runs
  `scripts\measure-startup.ps1` right after a reboot; then this entry is
  closed (if inside the Fast tier of 1 s) or kept open with a fix plan.
- **Target:** measurement at the next reboot; any fix before v0.1.

### KI-004 - The app icon is a placeholder (Minor)
- **Found in:** Step 01b. **Severity:** Minor (cosmetic).
- **What:** The window/taskbar icon is a generated solid-blue square
  (`src-tauri/icons/icon.ico`), not a designed Adperastra icon.
- **Workaround:** none.
- **Target:** a designed icon before v0.1 (Step 08c release polish at the
  latest).

### KI-005 - Snap-layout flyout not yet confirmed visually by the owner (Minor)
- **Found in:** Step 01b. **Severity:** Minor (until confirmed).
- **What:** The custom maximize button now reports `HTMAXBUTTON` to
  Windows (verified by message test), so the Windows 11 snap-layouts
  flyout should appear on hover - but the owner has not yet seen it with
  their own eyes.
- **Workaround:** window snapping still works with Win+arrow keys and by
  dragging the title bar to a screen edge.
- **Target:** owner confirmation in normal use; if the flyout does not
  appear, this becomes a Step 02 fix.

### KI-009 - A pinned folder renamed or deleted outside the app stays stale in the nav pane (Minor)
- **Found in:** Step 02. **Severity:** Minor (rare edge case).
- **What:** The open folder and This PC update live (watch + drive polling), but a pinned folder itself being renamed or deleted in another app is not noticed; the nav pane keeps the old entry until you unpin it or restart. Clicking it shows "This folder could not be opened."
- **Workaround:** unpin the stale entry (open it fails, so use the unpin button next to it) and pin the renamed folder; or restart the app.
- **Target:** Step 07a background refresh (the metadata service can verify pinned paths then).

### KI-014 - Renaming has no Undo yet (Major, deferral approved)
- **Found in:** Step 03a. **Severity:** Major (rules.md section 3 asks for an undo toast after every rename).
- **What:** Rename works (F2 or a second click on the name), never overwrites another item, and explains every refusal, but there is no Undo toast or Ctrl+Z for it yet.
- **Workaround:** rename the item back.
- **Approval:** the owner approved deferring it to Step 03b on 2026-10-28 (the undo stack arrives there).
- **Target:** Step 03b (undo stack v1); must be fixed before v0.1.

### KI-015 - Some command bar and menu entries are placeholders (Minor)
- **Found in:** Step 03a. **Severity:** Minor (placeholders, by owner decision on 2026-10-28).
- **What:** New, Cut, Copy, Paste and Delete are shown but disabled until the file-operation engine (Step 03b); the List and icon views under View are disabled until the view modes (Step 05). Their tooltips say they arrive in a later update.
- **Workaround:** Windows' own commands are available through Show more options.
- **Target:** Steps 03b and 05.

### KI-016 - Some classic-menu commands may do nothing (Minor)
- **Found in:** Step 03a. **Severity:** Minor (rare, Windows design).
- **What:** "Show more options" hosts the classic Windows menu outside Windows Explorer. Commands that expect Explorer's own file list around them (for example Rename in the classic menu) may do nothing. Everything Adperastra's own menu offers works.
- **Workaround:** use Adperastra's own Rename (F2) and menu commands.
- **Target:** review with Windows integration (Step 16).

## Fixed

### KI-017 - App start looked slower than Step 01b (closed after measuring, Step 03a)
One early 03a run took 1.14 s to be ready. Measured side by side with
`scripts/measure-startup.ps1` (cold WebView2, 5 runs each after the
one-time first run): the `v0.0.4-step02` build was ready in 825-874 ms
(median 841) and Step 03a in 702-870 ms (median 779), with first paint
around 90 ms in both. Step 03a is not slower than Step 02 and every run is
inside the 1 s Fast tier; the time added since Step 01b (0.70 s) comes
from Step 02's Home data. The 1.14 s run was a one-off. Numbers:
`docs/benchmarks/2026-10-28-startup-step02.json` and
`docs/benchmarks/2026-10-28-startup-step03a.json`.

### KI-013 - Hidden and system files were always shown (fixed in Step 03a)
Hidden items are now hidden by default, like Windows, and **View** >
**Hidden items** shows them (dimmed); the choice is saved in settings
(schema 3). Fixed in commit `08a6cef`, earlier than its 10b target because
the Step 03a View menu asks for the toggle.

### KI-010 - Explorer-state save was not fully atomic and reads were unlocked (fixed in Step 02)
When the first rename failed, the writer deleted `explorer-state.json`
before renaming its replacement, so a crash in between lost pins and
recent folders; the settings and session files used the same writer. The
shared writer now flushes the temp file, replaces the target in one rename
step, and retries a busy target instead of deleting it; state reads take
the writers' lock. Fixed in commit `4f774c3` (tested: replace without
leftovers, target never deleted when it cannot be replaced).

### KI-011 - File IDs lost precision crossing to TypeScript (fixed in Step 02)
`file_id` was a JSON number, which JavaScript cannot hold exactly above
2^53. It is now a decimal string on both sides, before tags (Step 11b)
rely on it. Fixed in commit `5cc8df0` (tested with an ID above 2^53).

### KI-012 - A very large Windows Recent folder could delay Home (fixed in Step 02)
Every shortcut was resolved before the 30-item limit applied. Shortcuts are
now sorted by their own time and resolved newest-first until 30 live
targets are found. Fixed in commit `e6074a3` (tested: 5,000 shortcuts, 31
resolved).

### KI-006 - Help center showed no pages in the packaged app (fixed in Step 01b)
The help client sent `language` where the Rust commands expect `lang`, so
every help call failed. Fixed in commit `1f902bd` (argument names aligned;
verified in the packaged app: 6 pages listed and rendered).

### KI-007 - Maximize button rectangle never reached Windows (fixed in Step 01b)
The button's `ref` was never attached, and the new `set_maximize_rect`
command was missing from the isolation allowlist - two silent failures in
a row. Fixed in commit `7362de4`; verified: the maximize area now returns
`HTMAXBUTTON` (9), close/content return `HTCLIENT` (1).

### KI-008 - Hardcoded-text lint false positive on TypeScript generics (fixed in Step 01b)
The lint's JSX-text regex could span from a generic's `>` across ordinary
code and flag it as UI text. Code-like spans are now skipped; the lint
still fails on a planted hardcoded string (probe-tested). Fixed in commit
`7422092`.
