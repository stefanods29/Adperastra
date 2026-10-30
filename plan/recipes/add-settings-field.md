# Recipe: add a settings field (schema bump)

Settings live in `settings.json` with a `schema_version`. Rust (`src-tauri/src/main.rs`) validates and migrates; TypeScript (`src/services/settings.ts`) normalizes. Both must change together, in one task. The task gives: the section, field names, types, allowed values, defaults, and the new schema number N.

## Rust (`src-tauri/src/main.rs`)

1. `pub const CURRENT_SCHEMA: u32 = N;`
2. Add the field to its section struct (or add a new section struct with `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]` and `impl Default`). Every new field has `#[serde(default = "default_<field>")]` (or `#[serde(default)]` for `false`, `0`, empty) and a `fn default_<field>()`.
   A new section is added to `pub struct Settings` with `#[serde(default)]` and to `impl Default for Settings`.
3. In `pub fn validate(...)`, add a check for each field with a fixed set of values or a range, in the same style as the existing checks.
4. Migration: in `pub fn migrate(...)`, the arms for older versions must keep the user's other settings. Step 04c added this function above `migrate`:
     ```rust
     /// Older files keep everything they have; fields added since then
     /// come from their serde defaults. Invalid files fall back to defaults.
     fn migrate_keep_known(value: serde_json::Value) -> Settings {
         match serde_json::from_value::<Settings>(value) {
             Ok(mut settings) => {
                 settings.schema_version = CURRENT_SCHEMA;
                 if validate(&settings).is_ok() {
                     settings
                 } else {
                     Settings::default()
                 }
             }
             Err(_) => Settings::default(),
         }
     }
     ```
     and the arm `Some(4) => Ok(migrate_keep_known(value.clone())),`. Every later bump adds the previous version to that same arm, for example for N = 6: `Some(4) | Some(5) => Ok(migrate_keep_known(value.clone())),`. Leave the `migrate_v1`, `migrate_v2`, `migrate_v3` arms as they are. If the new section is built field by field anywhere (`migrate_v1` and `impl Default for Settings` list every section), add the new section there with its `::default()`.
5. Existing tests compare `schema_version` with a fixed number. In the Rust test `settings_defaults`, change that number to N; in every other Rust test change it to `CURRENT_SCHEMA` (this updates the tests to the new schema, it does not weaken them). In `src/__tests__/settings.test.ts`, the line `expect(defaultSettings().schema_version).toBe(<N-1>);` becomes `toBe(N)`, and the expected object in "keeps valid values" gets the new section with its default.
6. Tests in the `#[cfg(test)] mod tests` at the bottom of `main.rs`:
   - `settings_v<N-1>_migrates_to_v<N>_keeping_language_and_theme`: build a JSON value of the previous version with `language: "es"` and `theme.mode: "dark"`, run `migrate`, assert `schema_version == N`, language and theme kept, the new field equals its default.
   - `settings_validate_rejects_bad_<field>`: a value outside the allowed set fails `validate`.

## TypeScript (`src/services/settings.ts`)

1. `export const SETTINGS_SCHEMA_VERSION = N;`
2. Add the field to its interface (or a new `export interface <Section>Settings`, added to `AppSettings`).
3. Add its default in `defaultSettings()`.
4. Add its parsing in `normalizeSettings()` with `pick(...)` for choices, `flag(...)` for booleans, or a clamped number for ranges, like the existing fields.
5. Test in `src/__tests__/settings.test.ts`: `normalizeSettings({})` gives the default; an invalid value falls back to the default; a valid value is kept.

## Also update

- `scripts/measure-ui.ps1`: the `$settings = @{ ... }` block: set `schema_version = N` and add the new section or field with its default (`plan/pitfalls.md` P-16).
- The Settings page, if the task says the field is shown there (`src/views/SettingsView.tsx` or the section file the task names), with labels from the translation files.

Commit message (given in the task) usually: `feat(settings): add <field> (schema N) [step-<id>/T<n>]`.
