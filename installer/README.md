# Installer and portable packaging (Step 08d T2/T3)

This folder holds the release-owned text and checks. `src-tauri/tauri.conf.json`
already references the NSIS hook, and `scripts/package-release.ps1` builds the
unsigned installer and portable ZIP. Workers do not run NSIS, the app, or a
build.

## Files

| File | Purpose |
|---|---|
| `adperastra-hooks.nsh` | Tauri NSIS install, upgrade and uninstall hooks. Per-user path, binary backup/rollback, bilingual uninstall choice. |
| `artifacts.json` | One source for the seven fixed public artifact names. Rust `artifact_inventory.rs` and `check-release-artifacts.mjs` both read it. |
| `check-release-artifacts.mjs` | Content check for a release folder: fixed names, SHA-256, byte sizes, `SHA256SUMS.txt`, no extra or forbidden files. |
| `portable-readme.txt` | Bilingual README placed in the portable ZIP. |

`adperastra-hooks.nsh` is saved as UTF-8 with BOM because NSIS 3 Unicode
must read the Spanish `LangString`s correctly. Keep the BOM when copying it.

## Tauri configuration

`src-tauri/tauri.conf.json` contains:

- `windows.nsis.installMode`: `"currentUser"`
- `windows.nsis.installerHooks`: `"../installer/adperastra-hooks.nsh"`
- `windows.nsis.languages`: `["English", "Spanish"]`

Do not set a certificate thumbprint, signing command, or private-key path.
The public release stays unsigned. The existing `package-setup.ps1` signing
path belongs to the development setup launcher and must not be used for the
public installer.

## Install and upgrade

- The app installs for the current Windows account under
  `%LOCALAPPDATA%\Programs\Adperastra`. The data folder remains
  `%LOCALAPPDATA%\Adperastra`, separate from the binaries.
- Before the new `Adperastra.exe` is written, the old one is copied to
  `Adperastra.exe.previous`. After installation the hook accepts the new
  binary only when it exists, is at least 1 MiB, and reports the expected
  version. Otherwise it restores the previous binary and stops with a
  bilingual message. Settings and data are never touched by this path.
- The hook sets `$INSTDIR` in `NSIS_HOOK_PREINSTALL`. The coordinator must
  confirm in the generated NSIS script that `$INSTDIR` is not used for
  shortcuts or uninstall registration before the hook runs; if it is, use a
  custom NSIS template instead of only the hook. This is a real installer
  check, not a worker claim.

## Uninstall

- The first question defaults to Keep. Remove requires a second confirmation
  that names settings, cached data, packs and version history.
- Remove runs `Adperastra.exe --recycle-app-data "%LOCALAPPDATA%\Adperastra"
  remove`. The helper in `installer_data.rs` accepts only that exact folder,
  refuses reparse points and folders with foreign content, and sends the
  whole folder to the Recycle Bin through the existing `fs_service` recycle
  operation. There is no recursive delete.
- Standard NSIS Yes/No buttons are used because Windows localizes them. The
  question and confirmation text are bilingual `LangString`s; stock NSIS
  localized strings are covered by the NSIS license notice. Keep these texts
  in sync with `uninstall.*` in `en.json`/`es.json` when either changes.
- A data folder chosen through `ADPERASTRA_DATA_DIR` is not removed by the
  uninstaller. Keeping the default is always safe.

## Portable ZIP (coordinator)

The ZIP contains the app, `help`, `templates`, `LICENSE`,
`THIRD_PARTY_LICENSES.txt`, `SOURCE-NOTICES.txt`, `README.txt` and
`portable-mode.marker` with exactly:

```json
{"enabled":true,"version":1}
```

On first start, a writable folder uses `AdperastraData` beside the app. A
read-only folder shows Choose data folder… / Cancel; Cancel keeps the
previous installed data location. Nothing is copied or deleted silently.

## Checks the coordinator runs

1. Build the unsigned installer and portable ZIP with
   `npm run release:package -- -Version 0.1.0 -Commit <40-hex-sha> -OutDir release`.
   The script runs `node installer/check-release-artifacts.mjs <release-dir> <version> <commit>`
   at the end.
2. In a clean Windows 11 Sandbox with synthetic data: clean install, upgrade
   from the previous build, reinstall, uninstall Keep, uninstall Remove,
   portable in a writable folder, portable in a read-only folder, offline
   start, and a machine without WebView2.
3. Confirm no administrator prompt for the normal install, the old binary is
   restored after a forced failed upgrade, and only the exact synthetic data
   folder appears in the Recycle Bin after Remove.
