# Owner tasks

## LibreOffice for local testing (2026-11-04)

The verified LibreOffice files were extracted locally and used to render disposable Word and PowerPoint documents. A system-wide installation is optional. Adperastra still needs a confined engine and a verified pack to use these capabilities in the app.

These checks need the owner and do not authorize publishing or changing GitHub.
Use only disposable test files and folders for file-operation checks. Report any
problem so it can be recorded and fixed.

## Measure startup after a reboot (KI-003, Major)

- [ ] Build the packaged app with `.\scripts\package-app.ps1`, then reboot.
  Immediately after signing in, close any running Adperastra windows and run
  the following from the repository in PowerShell:

  ```powershell
  .\scripts\measure-startup.ps1 -Step post-reboot -Runs 5
  ```

  The script writes its measurements to `docs\benchmarks\` and stops only
  the isolated Adperastra test process and its children. Share the
  result for comparison with the 1-second startup tier. A miss needs a fix
  before the v0.1 milestone.

## Check Step 03b in the app

See `docs/step-reports/step-03b.md` for the full test checklist and build
instructions. In English and Spanish, and in light and dark themes:

- [ ] Check creation, copying, cutting and moving, rename, deletion, Undo and
  Redo; test the conflict choices (Merge two folders, Skip, Keep both) and the
  numbered names. Use disposable files.
- [ ] Cancel a large copy and check that no partial file remains; confirm Undo
  affects only completed work.
- [ ] Check the system-item warning using a disposable test item, not an
  operating-system file.
- [ ] Try drag and drop within the app and both ways with Windows Explorer or
  the desktop, including modifier keys and the drop badge.
- [ ] Paste a screenshot and text as files and check the resulting names and
  file contents.
- [ ] Check keyboard navigation and closing in Help tabs, and use Windows
  Narrator to check tab names, column headings, sort order and the address bar.
- [ ] Confirm that hovering over the maximize button shows Windows 11 snap
  layouts (KI-005).
- [ ] Review the Step 03b screenshots and the accessibility/setup-font design
  deviations referenced in the report; check the setup window remains readable
  with its payload font absent.

## Version history and templates (06b/06c)

- [ ] Use the isolated disposable-file instructions in `docs/step-reports/step-06b.md` and `step-06c.md` for the remaining Windows dialogs, Office formulas/app opening, personal-template folder persistence and crash-recovery checks. The automated release checks cover only a subset.
- [ ] Decide when to repair the existing Save/Save as safety issues KI-068/KI-069. They are documented, not silently changed in this batch; use disposable files until repaired. No release may ship with them open.
- [ ] Existing editor style violations KI-075 and stale byte-size display KI-078 need a later repair. The current CSP and CodeMirror setup are unchanged from the earlier baseline; no CSP relaxation or warning suppression was applied.
- [ ] Earlier-step speed regressions and missing owner checks remain pending; the new JSON records are scoped to 06b/06c. No local tag was advanced.
