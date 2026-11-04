# Owned registry ledger

The ledger lives at `<base_dir>\windows-integration-ledger.json` and is
profile-independent installation state. `<base_dir>` is the Step 10c
`ProfileRoot.base_dir`, never a profile folder.

## Rules

- `ledger_schema` is 1. A newer or corrupt file is refused, not reset.
- Each row stores `key`, `name`, `installed_value`, `previous_value`,
  `previous_value_type`, `value_type`, `app_version` and `ledger_schema`.
- The previous value type is stored with the bytes so a restore cannot write
  the right bytes with the wrong Windows type.
- Keys are fixed app-owned relative paths under `HKEY_CURRENT_USER`.
  Shared keys are allowed only for app-named values:
  - `Software\Classes\.<ext>\OpenWithProgids` value
    `Adperastra.File.<ext>`
  - `Software\Classes\Applications\Adperastra.exe\SupportedTypes` value
    `.<ext>`
  - `Software\RegisteredApplications` value `Adperastra`
  - `Software\Microsoft\Windows\CurrentVersion\Run` value `Adperastra`
- `UserChoice`, `FileExts` and handler hashes are never read as owned and
  never written.
- Disable and uninstall restore a value only when the current bytes and type
  still equal `installed_value`. A foreign replacement is preserved and the
  row is dropped, so the app stops claiming it.
- Writes are preflighted; a value the app did not install is never
  overwritten (`windows_integration.denied`).
- A failed apply rolls every write and restore back to the state before the
  call and keeps the previous ledger on disk.

## Ordering

1. `--restore-integration` runs before file removal.
2. Restore matching owned values (write the previous value, or delete the
   value when there was none).
3. Clear the ledger with the crash-safe app-state writer.
4. Only then remove binaries and shortcuts.
