# Recipe: add a Tauri command

Use this whenever a task says "add the command `<name>`". The task gives the name, arguments, return type, and error codes.

## Steps

1. **Rust function** in the feature module the task names (`src-tauri/src/<feature>.rs`). If the module is new, create the file and add `mod <feature>;` next to the other `mod` lines at the top of `src-tauri/src/main.rs`.

   ```rust
   #[tauri::command]
   pub async fn <name>(window: WebviewWindow, <arg>: <Type>) -> Result<<Out>, String> {
       ensure_main(window.label())?;
       // validate every argument here (see the table below)
       tauri::async_runtime::spawn_blocking(move || <pure_fn>(<args>))
           .await
           .map_err(|e| e.to_string())?
   }
   ```
   Use `fn` instead of `async fn` only for commands that do no disk or CPU work (for example reading a value from `AppState`). Commands that need shared state take `state: State<'_, AppState>` as the second parameter and copy what they need out of it before `spawn_blocking`.

2. **Register it** in `src-tauri/src/main.rs`, inside `tauri::generate_handler![ ... ]`, at the end of the list: `<feature>::<name>,` (no module prefix if it is in `main.rs`).

3. **Allow it** in `src-tauri/isolation/index.html`: add `'<name>'` inside `new Set([ ... ])`, on the line with the other commands of the same feature (or a new line).

4. **TypeScript wrapper** in `src/services/<feature>.ts`:
   ```ts
   export async function <camelName>(<arg>: <TsType>): Promise<<TsOut>> {
     return (await invoke("<name>", { <camelArg> })) as <TsOut>;
   }
   ```
   The keys are the Rust parameter names in camelCase (`request_id` becomes `requestId`). Always pass a literal object.

5. **Errors:** every code the command can return (`"<area>.<reason>"`) gets a key `errors.<area>.<reason>` in `en.json` and `es.json`, plus `errors.<area>.other` (`plan/recipes/add-translation-keys.md`).

6. **Tests:** a Rust test for the pure function (success and each error code) and, when the task says so, a validation test.

7. Run `.\scripts\gate.ps1`. `lint:ipc` fails if step 2, 3 or 4 is wrong; read its message, it names the exact problem.

## Validation table

| Argument | Check | Error code |
|---|---|---|
| A path the user picked | `validate_absolute_path(&path)` | `<area>.not_found` |
| A folder that must exist | `Path::new(&p).is_dir()` inside `spawn_blocking` | `<area>.not_found` |
| A name | `chars().count() <= 255` and `fs_service::validate_new_name(&name)` | `<area>.invalid_name` |
| A list of paths | `!is_empty()` and `len() <= 10_000`, each one with `validate_absolute_path` | `<area>.invalid_request` |
| Free text | `chars().count() <=` the limit in the task | `<area>.too_long` |
| A choice ("png" / "jpg") | `match` on the allowed values | `<area>.invalid_request` |
| A request ID | `valid_request_id(&id)?` | (plain error) |
| A file token | `crate::files::path_for_token(&state, &token)?` (Step 04a) | `files.no_access` |
