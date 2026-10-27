# Git workflow and testing

## Version control, so every change can be traced and undone

- Create the Git repository in Step 00, before any code, connected to my GitHub repository. Set up `.gitignore`, `.gitattributes` (line endings), and branch protection on `main` (no direct pushes once Step 01b is merged).
- **Branches:** `main` (always releasable), `testing` (where finished work is checked before reaching `main`), and one branch per step (for example `step-03b-file-operations`) created from the latest `testing`. When a step is done, merge it into `testing`, run the full local test suite there, fix anything it finds on the step branch, and only after everything passes and I approve, merge `testing` into `main` through a pull request and tag `main` (for example `v0.0.12-step03b`; milestone releases get `v0.1.0`, `v0.2.0`...). Push the step branch to GitHub at least every few commits, so nothing lives only on my PC.
- **Commit small and often:** one logical change per commit (a new command, a component, a fix, a test), committed as soon as it builds and its tests pass. Never one giant commit per step, never mix unrelated changes. Each commit must build, so problems can be found with `git bisect`.
- **Commit messages** follow Conventional Commits with the step: `feat(explorer): add breadcrumb path editing [step-02]`, `fix(pdf): stop first-page flicker [step-07b]`, and the types `perf`, `test`, `docs`, `refactor`, `chore`, `deps`. The first line says what changed; the body says why and how it was tested, and references any GitHub issue.
- **Dependencies** get their own commits (`deps: add pdfium-render 0.8.x (Apache-2.0)`), with the license noted, so every library can be traced to when and why it was added.
- **Before every commit:** formatter, linter, hardcoded-text check, and fast tests (a pre-commit hook). **Before every push:** the `--quick` test suite.
- **Never rewrite history on `main`** (no force-push). To undo something, use `git revert`, so the undo itself is recorded.
- Keep `CHANGELOG.md` (Keep a Changelog format) updated in each step's pull request, and record important decisions (stack, engines, models) as short decision records in `docs/decisions/`, so I can see why something was done, not just what.
- Never commit secrets, personal files, test files with private data, or files over 50 MB (see `rules.md`).
- If I ask "what changed?" or "when did this break?", answer from the Git history (`git log`, `git diff`, `git bisect`), not from memory.

## Testing and safety (local, developer-only)

- All tests live in their own folders (`tests/`, `fuzz/`, `e2e/`, `bench/`, `test-files/`) and are **never included in the version users download**: release builds exclude them, and a CI check verifies the installer and the portable zip contain no test code or test files.
- One command runs everything locally and produces a readable report (HTML plus a terminal summary): for example `scripts/test-all.ps1` or `cargo xtask test-all`, with `--quick` (a few minutes, before every push) and `--full` (on the `testing` branch before anything reaches `main`). Explain in plain language how to run it and read the report.
- What `--full` runs:
  - **Unit and integration tests** for the Rust core and the UI logic.
  - **End-to-end UI tests** that click through the real app (open folders, copy, rename, undo, open each file type, convert, tabs and groups, split view, settings) with Playwright or WebdriverIO, in English, Spanish, and the pseudo-locale.
  - **Screenshot comparisons** against the Figma frames and the previous approved screenshots, in every built-in theme.
  - **Speed checks** from `speed.md` on the test corpus; fail on slowdowns over 20% compared to the previous step.
  - **Fuzz testing** of everything that reads files (type detection, metadata, archives, the privacy cleaner, converters' input handling, and the boundaries where we pass data to PDFium, FFmpeg, LibreOffice, and image libraries) with `cargo-fuzz`, for a time I choose (default 10 minutes per target; longer overnight runs optional). Every crash found is saved in `test-files/regressions/` and becomes a permanent test. It uses the CPU fully while running, so it only runs when I start it.
  - **Malicious and broken file set:** zip bombs, files with wrong extensions, decompression-bomb images, corrupted PDFs and Office files, files with macros or embedded scripts, very long and Unicode-tricky names, reserved names, link loops, and downloaded files (Mark of the Web), checking that the app never crashes, freezes, runs embedded code, or uses unbounded memory.
  - **Sandbox checks:** each webview can only call its allowed commands; untrusted content can't reach the app's commands or the network; helper processes have no network access.
  - **File-safety tests:** copy, move, rename, bulk rename, convert, privacy clean, and locked folders never lose or corrupt data; deletes go to the Recycle Bin; undo works; version history restores; a forced crash in the middle of each operation leaves files intact; online-only placeholder files are never downloaded by background work.
  - **Help pages:** every feature has a help page in every app language, and links from the app to help pages work.
  - **Office round-trip tests** (open, save, reopen, compare) once Office editing exists.
  - **AI tests** (when packs are installed): the evaluation sets in `ai.md`, including prompt-injection files that try to make the assistant delete or move things.
  - **Security checks:** `cargo-audit` and `npm audit`, `cargo-deny` and a JS license checker, a secrets scan, and the 50 MB file check.
  - **Accessibility checks** (axe-core) and a keyboard-only run of the main flows; from Step 10c, also Narrator and NVDA checklists.
  - **Install, update, and uninstall test** of the installer in Windows Sandbox (built into Windows 11 Pro) or a virtual machine, including the setup window repairing a missing component and the uninstaller's keep-or-remove-data choice.
- The `--quick` suite runs automatically on GitHub for every push, and `--full` (with shorter fuzzing) runs weekly on GitHub's free build servers.
- A step is not done until `--full` passes on the `testing` branch. Report results in the step report, and never disable or skip a failing test to make it pass; fix the cause or ask me.
