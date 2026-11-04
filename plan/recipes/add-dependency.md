# Recipe: add a library (dependency)

Only libraries that the step recipe names, with the version it names. Never a different library, even if it looks better.

## Rust crate

1. Add the line the recipe gives to the right `Cargo.toml` (`src-tauri/Cargo.toml`, `crates/<crate>/Cargo.toml`), under `[dependencies]` (or `[target.'cfg(windows)'.dependencies]` when the recipe says Windows-only), for example `infer = "0.22"`.
2. Run `cargo build -p <package>` (with `CARGO_TARGET_DIR` set as in `gate.ps1`) so `Cargo.lock` updates.
3. New `windows` crate features: add the feature names to the existing `windows = { version = "0.61", features = [...] }` list. Same commit rules.

## npm package

1. `npm install <name>@<version> --save-exact` (or `--save-dev --save-exact` for build-time tools), with the version from the recipe.
2. `npm audit --omit=dev` must not report high or critical issues; if it does, stop with `BLOCKED.md`.

## Record it (same commit)

1. `THIRD_PARTY_LICENSES.md`, section "App shell libraries": add one bullet in the existing style: `- **<name>** <version> (<license>) - <what it does for the user> (Step <id>).`
2. `docs/dependency-and-license-table.md`: add a row to the table for the step's area, or extend the matching row, saying it was adopted in Step <id>.

## Commit

Only `Cargo.toml`/`Cargo.lock` or `package.json`/`package-lock.json` plus the two record files:

```powershell
git add -A
git commit -m "deps: add <name> <version> (<license>) [step-<id>/T<n>]"
```

Then continue with the task's code change and its own commit. Run the gate before both commits.
