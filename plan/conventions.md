# Code conventions (how code is written in this repository)

Follow these patterns exactly. They match the code that already exists. When a recipe gives code, it already follows them.

## 1. Repository map

| Path | What it is |
|---|---|
| `src-tauri/src/main.rs` | App entry, `AppState`, settings and session, all `#[tauri::command]`s up to Step 03b, `generate_handler!` list |
| `src-tauri/src/<feature>.rs` | **New commands go here**, one module per feature (Step 04a on). Existing: `explorer.rs`, `shell.rs`, `clipboard.rs`, `drag.rs`, `classic_menu.rs` |
| `src-tauri/isolation/index.html` | Isolation allowlist: every command name must be in `ALLOWED` |
| `src-tauri/tauri.conf.json` | Window, CSP, bundle settings |
| `src-tauri/capabilities/main.json` | Tauri permissions for the main window |
| `crates/fs-service/` | Pure Rust file-system logic (list, sort, watch, state, rename, ops). Testable without Tauri |
| `crates/<new-crate>/` | New pure Rust logic that needs no Tauri (recipes say when) |
| `src/App.tsx` | Tab host, title bar, status bar, settings application |
| `src/views/ExplorerHome.tsx` and `src/views/explorer/*` | The Explorer tab |
| `src/views/<Feature>View.tsx` | Other tab views (Help, Settings, Gallery) |
| `src/handlers/` | File-type handlers (Step 04a on): `registry.ts`, `index.ts`, one folder per handler |
| `src/services/<feature>.ts` | The only place that calls `invoke()`. Typed wrappers + pure helpers |
| `src/commands/registry.ts`, `menus.ts`, `explorerCommands.ts` | Command registry (contract 7), menus as data (contract 9) |
| `src/components/` | Shared UI components (`plan/ui-kit.md`) |
| `src/i18n/locales/{en,es,pseudo}.json` | All UI text. `pseudo.json` is generated |
| `src/styles/tokens.css` | Generated CSS variables (do not edit; run `npm run tokens` after editing `themes/*.tokens.json`) |
| `src/styles/components.css`, `global.css` | Existing styles. **New feature styles go in `src/styles/<feature>.css`**, imported in `src/main.tsx` |
| `src/__tests__/` | UI tests (Vitest + jsdom), `<feature>.test.ts(x)` |
| `crates/*/tests/` | Rust integration tests, `step<id>_<topic>_tests.rs` |
| `help/en/`, `help/es/` | Help pages, one per feature, same file names in both |
| `scripts/` | Gate, lints, packaging, measurements |
| `docs/step-reports/`, `docs/decisions/`, `docs/benchmarks/`, `docs/screenshots/` | Records written at the end of each step |

## 2. Size limits (to keep files readable)

- A new file stays under 400 lines. If it grows past that, the recipe splits it; do not split on your own.
- Do not add more than about 40 lines per task to `src-tauri/src/main.rs`, `src/views/ExplorerHome.tsx` or `src/App.tsx`. Put new logic in new modules and call it from there.

## 3. Rust backend

### 3.1 A Tauri command (template)

```rust
// src-tauri/src/<feature>.rs
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::WebviewWindow;

use crate::{ensure_main, validate_absolute_path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThingInfo {
    pub size_bytes: u64,
}

/// One sentence: what it does. Errors are `<area>.<reason>` codes.
#[tauri::command]
pub async fn feature_do_thing(window: WebviewWindow, path: String) -> Result<ThingInfo, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "feature.not_found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || read_thing(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Pure, testable part (no Tauri types).
pub fn read_thing(path: &Path) -> Result<ThingInfo, String> {
    let meta = std::fs::metadata(path).map_err(|_| "feature.not_found".to_string())?;
    Ok(ThingInfo { size_bytes: meta.len() })
}
```

(`validate_absolute_path` and `ensure_main` live in `main.rs`; feature modules reach them as `crate::...`.)

Rules:
1. `pub` command functions in feature modules; `mod <feature>;` in `main.rs`; add `<feature>::feature_do_thing,` to `generate_handler![...]`; add `'feature_do_thing'` to `ALLOWED` in `src-tauri/isolation/index.html`. `npm run lint:ipc` checks all three.
2. First line: `ensure_main(window.label())?;`. Then validate every argument. Paths: `validate_absolute_path` (absolute, no `..`). Text: check `chars().count()` against a limit. Lists: check `len()` against a limit.
3. Disk or CPU work goes inside `tauri::async_runtime::spawn_blocking`. Never block an `async fn` directly.
4. Return `Result<T, String>`. Known failures are codes `"<area>.<reason>"` (lower snake case, for example `"viewer.too_large"`). Unknown errors may be `e.to_string()`; the UI then shows `errors.<area>.other`.
5. Names: command functions are `snake_case`, start with the feature area (`file_grant`, `archive_list`). Data structs derive `Debug, Clone, Serialize, Deserialize`, with **snake_case fields** (the TypeScript interfaces use the same snake_case names; do not add `rename_all`).
6. Shared state: add a field to `AppState` in `main.rs` and initialize it in `main()`. Use `Mutex` and never `.lock().unwrap()`; use `.lock().map_err(|_| "<name> lock poisoned".to_string())?`. Never hold a lock while doing disk work or across `.await`.
7. Pure logic that does not need Tauri goes in a crate (`crates/fs-service` or the crate the recipe names) and gets unit tests there.
8. Windows API: use the `windows` crate version already in `Cargo.toml` (0.61). If a recipe needs a new feature flag (for example `Win32_Storage_Packaging`), add it in its own `deps:` commit. Wrap unsafe calls in small functions with a `// SAFETY:` comment saying why the call is correct.
9. The app is Windows-only (Windows 11). New code may call Windows APIs directly; it does not need stubs for other systems. Keep the existing `#[cfg(windows)]` blocks exactly as they are, and follow the style of the file you are editing.

### 3.2 Long work: start / poll / cancel

Tauri `Channel` does not work under our isolation pattern (`plan/pitfalls.md` P-01). Long work uses three commands:
- `<area>_start(request_id, ...)`: validates, stores a job entry, runs the work in `spawn_blocking`, returns at once.
- `<area>_poll(request_id)`: returns `{ progress, done, result, error }`; drops the job when `done` is true.
- `<area>_cancel(request_id)`: sets the job's `CancellationToken` (`fs_service::new_cancellation_token()`).

From Step 06d, new jobs use the shared job table in `src-tauri/src/jobs.rs` (`jobs::Jobs`) and the shared `job_poll` / `job_cancel` commands instead of writing their own poll and cancel. The TypeScript side polls every 100 ms with `src/services/jobs.ts` (`runJob()`), also added in Step 06d. Request IDs come from `newRequestId(prefix)` and are checked with `valid_request_id`.

### 3.3 Events (Rust to UI)

For things the UI must hear about without asking (folder changes, open-file requests): `app.emit("kebab-case-name", payload)` in Rust; `listen("kebab-case-name", handler)` in a `src/services/*.ts` file, returning the `UnlistenFn` to the caller.

### 3.4 Rust tests

- Pure logic: tests in the crate, `crates/<crate>/tests/step<id>_<topic>_tests.rs`, using `tempfile::tempdir()` for real files.
- Command validation in `src-tauri`: `#[cfg(test)] mod tests` at the bottom of the feature module, calling the pure functions.
- Name tests by behavior: `refuses_entry_outside_destination`, `cancel_leaves_no_partial_file`.

## 4. TypeScript UI

### 4.1 Calling Rust

Only `src/services/*.ts` import `invoke`. Template:

```ts
// src/services/<feature>.ts
import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `ThingInfo` (snake_case fields, same names). */
export interface ThingInfo {
  size_bytes: number;
  kind: "a" | "b";
}

export async function featureDoThing(path: string): Promise<ThingInfo> {
  return (await invoke("feature_do_thing", { path })) as ThingInfo;
}
```

- Argument keys are camelCase in TypeScript; Tauri turns them into the snake_case Rust parameters (`{ requestId }` reaches `request_id`). A single struct argument keeps its snake_case fields inside (`{ request: { dest_dir: ... } }`). `npm run lint:ipc` checks the names.
- Code that must also run in the browser preview or in tests checks `isTauriRuntime()` (from `src/services/settings.ts`) before calling Rust.

### 4.2 Errors in the UI

Use `src/services/errors.ts` (added in Step 04a):
- `errorCode(error)` returns the code string from a rejected `invoke` (`"viewer.too_large"`), or `""`.
- `errorText(t, error, area)` returns `t("errors.<area>.<reason>")`, falling back to `t("errors.<area>.other")`.
Every area that returns codes has `errors.<area>.other` plus one key per reason in `en.json` and `es.json`.

### 4.3 Components and state

- Function components with hooks. No new state library. App-wide state (tabs, settings) lives in `App.tsx`; feature state lives in its view and is passed down as props.
- Text: `const { t } = useTranslation();` and `t("area.key", { count })`. Never a literal string shown to users.
- Lazy-load anything big: `const PdfView = lazy(() => import("./PdfView"));` inside `<Suspense fallback={<Skeleton ... />}>`.
- Commands (contract 7): every user action is a `Command` in a `create<Feature>Commands(actions)` factory (`src/commands/<feature>Commands.ts`), shown through `MenuEntry`/`BarEntry` data (contract 9). Command IDs: `<area>.<camelCaseVerb>` (`tabs.closeTab`, `viewer.zoomIn`). `labelKey` is `commands.<camelCase>`. `helpSlug` is an existing help page.
- CSS: new classes start with `adp-<feature>-`. Colors only through `var(--adp-...)`. New feature styles in `src/styles/<feature>.css`, imported in `src/main.tsx` after `components.css`.
- Icons: `lucide-react`, `size={16}` in menus and bars (`size={14}` in tabs), always `aria-hidden="true"` with a translated label on the button.

### 4.4 UI tests

- Pure logic (reducers, parsers, formatters, registries): unit tests with plain inputs.
- Components: plain React DOM, as the existing tests do (`src/__tests__/fileList.test.tsx` shows the pattern: `import "../i18n"`, `createRoot` + `act`, unmount in `afterEach`, `vi.mock` for `@tanstack/react-virtual`). Do not add a testing library.
- Name: `src/__tests__/<feature>.test.ts(x)`; `describe("<thing>")`, `it("<does what>")`.

## 5. Settings (both sides)

Settings live in one JSON file with a `schema_version`. Adding a field always follows `plan/recipes/add-settings-field.md`: Rust struct + default + `validate()` + `CURRENT_SCHEMA` + a `migrate` arm + test, and TypeScript interface + `defaultSettings()` + `normalizeSettings()` + `SETTINGS_SCHEMA_VERSION` + test, and `scripts/measure-ui.ps1`'s settings block.

## 6. Help, translation, commits

- Help pages: `plan/recipes/add-help-page.md`.
- Translation keys: `plan/recipes/add-translation-keys.md`.
- Commit messages: Conventional Commits with the step and task: `feat(viewer): show images in file tabs [step-04a/T6]`. Types: `feat`, `fix`, `perf`, `test`, `docs`, `refactor`, `chore`, `deps`. A dependency is always its own `deps:` commit (`plan/recipes/add-dependency.md`).
