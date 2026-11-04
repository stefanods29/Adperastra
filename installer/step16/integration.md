# Installer integration for Step 16

This is the specification the coordinator applies to the NSIS package
scripts. It does not install, sign or publish anything.

## Paths and ownership

- Per-user install: `%LOCALAPPDATA%\Programs\Adperastra`, no administrator
  requirement.
- Data stays in `%LOCALAPPDATA%\Adperastra` (or the portable/explicit
  `ADPERASTRA_DATA_DIR`), separate from the binaries.
- The installer creates a portable marker only for the portable ZIP, as
  specified by Step 08d.

## Registry ownership

1. Before removing or replacing files, call:

   ```nsis
   ExecWait '"$INSTDIR\Adperastra.exe" --restore-integration' $0
   ```

   The helper restores only values that still match what the app installed
   (see `ledger.md`). A non-zero result does not stop the uninstall; it is
   recorded for the report.
2. Never write `UserChoice`, `FileExts`, handler hashes or another program's
   values from the installer.
3. Association choices are opt-in in the installer UI; the default is no
   family selected.

## Upgrade with a running instance

1. Detect a running `Adperastra.exe`.
2. Ask it to close through the normal single-instance/activation channel,
   not by terminating the process.
3. If the user cancels a dirty decision, stop the upgrade and keep the old
   binaries and all data. `installer_integration::plan_upgrade` returns this
   decision; `force_terminate` is always false.
4. Only after the process exits: stop helpers, replace binaries, keep
   settings, sessions, versions, packs and the integration ledger.

## Uninstall

- Default button: **Keep my settings and data**. It removes binaries,
  shortcuts and the owned registry values only.
- **Remove my settings and data** is a second, explicit choice after the
  loss warning from Step 08d.
- Removing data uses the Recycle Bin and only the exact recorded
  `base_dir` (`installer_integration::plan_uninstall`). A junction, a moved
  folder, another drive, a drive root, the Windows folder or Program Files
  is refused with `installer.foreign_root` / `installer.unsafe_root`.
- Never call a blanket recursive delete on a computed path.

## What is never done

- No administrator elevation for the core app.
- No certificate installation, Developer Mode change or private-key access.
- No package publication.
- No download when an offline artifact is missing or changed.
