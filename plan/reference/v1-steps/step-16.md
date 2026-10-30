# Step 16: Windows integration and release polish (★★★★)

**Needs:** 09a, 12a. **Builds:** shell integration, installer polish, stay-in-background mode. **Milestone:** v0.4 after this step.

## Tasks
- **"Show more options"** in our right-click menu hosts the classic Windows shell-extension items reliably (with the timeout from Step 03a).
- **Windows Explorer integration:** add "Convert to..." and "Open with Adperastra" to the real Windows 11 Explorer right-click menu through the supported mechanism (research it, probably a packaged or sparse app with a shell command, and explain the trade-offs to me), launching through the single-instance path so it feels instant. Optional, chosen in Settings, and removed cleanly on uninstall.
- **Installer polish:** optional file associations chosen during install (none forced), clean upgrade between versions, the uninstaller's keep-or-remove-data choice, and the full offline installer variant that includes selected packs.
- **"Stay in background" mode (optional, off by default):** a switch in Settings > Startup that keeps a small, idle copy of the app running after the last window closes and optionally starts it with Windows, so opening the app shows a window within the Instant-to-Fast range. Shows a tray icon while active, with "Open", "Turn off stay in background", and "Quit". When idle, it unloads engines, models, in-memory caches, and webviews except one; its measured memory use is shown next to the switch. Turning it off quits the background copy immediately. It never runs anything else in the background unless I enabled those tasks separately.
- **Update check polish** (still optional and off by default): shows "What's new" from the release notes and a link to the GitHub release.

## Help pages
Windows Explorer integration; file associations; stay in background; updating.

## Done when
Install, upgrade, and uninstall are clean in Windows Sandbox; "Convert to..." works from the Windows Explorer right-click menu when enabled; stay-in-background opens instantly and shows its memory use. I approve and v0.4 is released.
