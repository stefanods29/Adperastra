# Step P2 report - Adopt plan v2 (tools and plan files)

Dates: 2026-10-30. Status: **done on local `testing`; not pushed**. No app code changed.

## What changed

- `AGENTS.md` and `opencode.json` now use the plan v2 agent instructions.
- `scripts/gate.ps1`: one local check that runs the file-size guard, `cargo fmt`, clippy with warnings as errors, Rust tests, translations, the Tauri IPC check, UI tests and the UI build.
- `scripts/check-ipc.mjs`: checks that every Tauri command is registered, allowlisted in the isolation frame, and called with the right argument names.
- `scripts/make-pseudo.mjs` and `scripts/icu-lite.mjs`: `npm run i18n:pseudo` now generates `pseudo.json`; `scripts/check-i18n.mjs` is the plan v2 version.
- `scripts/check-base.mjs`: compares the recipe base files with `plan/base.json`.
- CI runs the same formatting, lint and IPC checks as the gate; `CONTRIBUTING.md` points to the gate.
- `plan/p2-files/` was removed after its files were put in place.

## Verification

- `.\scripts\gate.ps1` prints `GATE PASSED`: Rust formatting, clippy, 146 Rust tests, 359 translation keys, IPC check, 84 UI tests and the UI build.
- `node scripts/check-base.mjs` reports that 8 files differ from commit `11aced2`, as expected after the Step 03b safety fixes: `.github/workflows/ci.yml`, `scripts/measure-ui.mjs`, `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `src/App.tsx`, `src/views/ExplorerHome.tsx`, `src/views/explorer/FileList.tsx` (the recipe's "find exactly" blocks for 04a-04c must be adapted where the text moved). Step 04a is doing that.
- The gate needed one fix: Windows PowerShell 5.1 treats cargo's progress on stderr as a terminating error. `scripts/gate.ps1` now allows native stderr during each check and still reads the real exit code (commit `3b75e04`).

## Decisions and deviations

- Local-only owner decision: no push, pull request, `main` change or tag. The normal P2 finish commands were adapted.
- `plan/p2-files/CLAUDE.md` was never tracked and was not copied; `CLAUDE.md` stays local-only.
- The base check failure is expected and does not block P2; it means the 04a-04c recipes must be adapted to the current code where their "find exactly" text moved.

## Commits

- `cb151c1` docs(plan): adopt plan v2 with step recipes [P2/T1]
- `6f3582f` chore(tools): add the gate script, the IPC check and the generated pseudo-locale [P2/T2]
- `ee5cc59` ci: run the same checks as the local gate [P2/T3]
- `211eec0` docs: point contributors to the gate script [P2/T5]
- `3b75e04` fix(tools): keep the gate running when a native tool writes to stderr [P2/F1]
- `a821594` docs(status): plan v2 adopted, next 04a
- `f47a930` docs(plan): remove plan/p2-files, its files are in place

## Next

Step 04a (file tabs, open pipeline, handler registry, image viewer), already in progress in a parallel worktree. 04b and 04c follow it.
