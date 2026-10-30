# Git and testing

## Branches and tags

- `main`: always releasable, protected (pull request + passing `build-windows` CI check). Never push to it directly, never force-push.
- `testing`: finished steps are merged here and checked before reaching `main`.
- One branch per step, created from `testing`, named in the step file (for example `step-04a-file-tabs`).
- Tags on `main` after the owner approves a step: the tag in the step file (`v0.0.7-step04a`). Milestones get `v0.1.0`, `v0.2.0`...
- The exact commands for starting, finishing and merging a step are in `AGENTS.md` section 4. Use them as written.

## Commits

- One commit per task, made only after `.\scripts\gate.ps1` prints `GATE PASSED`.
- Message: `<type>(<area>): <what changed> [step-<id>/T<n>]`, as given in the task. Types: `feat`, `fix`, `perf`, `test`, `docs`, `refactor`, `chore`, `deps`.
- A new library is its own commit before the task's commit: `deps: add <name> <version> (<license>) [step-<id>/T<n>]` (`plan/recipes/add-dependency.md`).
- Never commit: build output (`dist/`, `target/`, `build/`), `node_modules/`, files over 50 MB, secrets, `BLOCKED.md` after it is answered.
- To undo a commit that is already pushed: `git revert <hash>` (never `reset` on a pushed branch).

## The gate (`scripts/gate.ps1`)

Runs, in this order, stopping at the first failure:

1. No tracked file over 50 MB.
2. `cargo fmt --all -- --check` (fix with `cargo fmt --all`).
3. `cargo clippy --workspace --all-targets -- -D warnings`.
4. `cargo test --workspace`.
5. `npm run lint:i18n`: en/es keys match, ICU is valid, arguments match, `pseudo.json` is current (fix with `npm run i18n:pseudo`), help pages exist in both languages, no hardcoded text in `.tsx`.
6. `npm run lint:ipc`: commands registered, allowlisted, and called with the right argument names.
7. `npm test` (Vitest).
8. `npm run build` (TypeScript check + Vite build).
9. With `-Package`: `scripts\package-app.ps1` (release build into `build\Adperastra\`).

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks on every push.

## What tests each task needs

The task lists them. As a rule:

| Kind of code | Tests |
|---|---|
| Pure Rust logic (parsers, validation, file operations) | Unit or integration tests with `tempfile` folders, including the failure cases the recipe names |
| Tauri command | A test of its pure function plus a validation test (bad path, too long, wrong value) |
| Pure TypeScript (reducers, registries, parsers, formatters) | Vitest unit tests |
| React view | A render test: it shows the right parts for a given input, and the main keyboard action works |
| Anything that writes files | Tests that prove R-SAFE: cancel/failure leaves no partial file; existing files are never overwritten without the decision; undo data is right |

## Checks by hand (end of every step)

The step file lists them. Run them in the packaged app (`.\scripts\gate.ps1 -Package`, then `build\Adperastra\Adperastra.exe`), in English and Spanish, light and dark. Write the result of each one in the step report.

## Screenshots

`scripts\measure-ui.ps1 -ScreenshotsOnly -Language <en|es|pseudo> -Theme <light|dark> -Shots docs\screenshots\step-<id>` takes the screenshots that `scripts\measure-ui.mjs` defines. Each step's recipe says which new screenshots to add to `measure-ui.mjs` (function `shot(name)`).

## Release builds

From Step 08d, releases are built by GitHub Actions from a tag on `main`. Release builds never contain tests, test files, or developer tools.
