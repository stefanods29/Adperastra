# Step 06c: Templates in the New menu

| | |
|---|---|
| State | guide |
| Difficulty | ★★ |
| Branch | `step-06c-templates` |
| Tag | `v0.0.16-step06c` |
| Depends on | 06b |
| Written before | P2 was built (written from the 04a to 04c recipes and the 05a to 06b guides; names from earlier guides are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

## Goal

The Explorer's **New** menu creates more than folders and text files: a Markdown note, a CSV table, a blank document (.docx), spreadsheet (.xlsx) and presentation (.pptx), and **From template…**, which opens a window with six built-in templates (letter, report, budget, invoice, meeting notes, simple presentation) in the app's language, plus **My templates**: every file in a folder the owner chooses. A new file appears in the open folder with its name selected for renaming, can be undone like any new item, and opens like any other file (Office files in the owner's Windows app until the Office viewers and editors exist).

## Do not do in this step

- No Office viewers or editors (Steps 13, 20b, 21a, 22a): Office files open through the open pipeline, which sends them to their Windows app today.
- No template editor and no template variables (dates or names filled in). No templates inside sub-folders of My templates.
- No "New" entries for other file types (images, archives); archives get "Compress to…" in Step 06e.
- The build script that makes the templates runs only on the developer's PC; the app never runs it and never ships `docx`, `exceljs` or `pptxgenjs`.
- No Microsoft names in the app (`plan/rules.md` R-LIC-5): the menu says **Document**, **Spreadsheet** and **Presentation**.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-03, P-08, P-11, P-16, P-25, P-28, P-32), `plan/rules.md` R-SAFE-3, R-SAFE-6, R-SEC-1, R-LANG-1 (default file names and templates are translated), R-LIC, `plan/recipes/add-dependency.md` (npm, development only), `plan/recipes/add-settings-field.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-help-page.md`.
- Code: `src/views/ExplorerHome.tsx` (`createNew`, `afterCreate`, `pendingRenameRef`, the actions object), `src/commands/explorerCommands.ts` (`explorer.newFolder`, `explorer.newTextFile`), `src/commands/menus.ts` (`NEW_MENU`), `src/services/fileops.ts` (`createItem`), `crates/fs-service/src/ops.rs` (`create_item`, `unique_destination`), `src-tauri/src/main.rs` (`help_roots`, `create_item`, the settings part), `src-tauri/src/file_dialogs.rs`, `src-tauri/tauri.conf.json` (`bundle.resources`), `scripts/package-app.ps1`, `src/views/explorer/fileTile.ts`, `package.json`.

## Decisions (already made)

- D1. **New menu** (command bar and the background right-click menu, which share `NEW_MENU`): New folder; Text file (today's command); Markdown note (`.md`); CSV table (`.csv`); Document (`.docx`); Spreadsheet (`.xlsx`); Presentation (`.pptx`); a separator; **From template…**. Every entry is a command, enabled only while a folder is open.
- D2. **Blank files**: `.txt`, `.md` and `.csv` are created empty (the existing `create_item`); `.docx`, `.xlsx` and `.pptx` are copies of three blank files shipped with the app. Default names are translated (`files.new*Name` keys), made unique the Windows way ("New note (2).md").
- D3. **Templates** live in a `templates` folder at the repository root, shipped like the help pages (`bundle.resources` and `scripts/package-app.ps1`): `templates/blank/blank.docx|xlsx|pptx` and `templates/builtin/<lang>/<file>` for `en` and `es`. Their words come from the translation files: `scripts/build-templates.mjs` (development only, `npm run templates`) reads the `templates.*` keys of `en.json` and `es.json` and writes the files with `docx` 9.15.0, `exceljs` 4.4.0 and `pptxgenjs` 4.0.1 (all MIT, development dependencies, checked at these versions). The generated files are committed (they are small); the script runs again whenever a `templates.*` text changes. A template for the pseudo-locale uses the English files.
- D4. **My templates**: a folder chosen in the template window (Windows' folder dialog) and stored in settings (`templates.my_folder`, schema 11). Every file directly in it (not hidden, not system, at most 200, natural name order) is a template; creating from it copies the file under its own name.
- D5. **Creating from a template** copies the file into the open folder under a unique name (the template's translated name for built-in ones, the file's name for My templates) by writing a partial file and renaming it (R-SAFE-3); the copy never has the Read-only attribute. Rust only copies templates from the app's template folders or the chosen My templates folder (R-SEC-1).
- D6. After any creation, exactly as **New folder** does today: an undo entry (Recycle Bin and restore), the "Created …" toast, and the new item selected with its rename box open. Nothing opens by itself (Windows behaves the same); double-click opens it.
- D7. **Template window** (`TemplatePickerDialog`): two lists, **Built-in templates** (icon, name, one-line description) and **My templates** (file names, or a note with a **Choose folder…** button when none is set or the folder is missing); buttons **Create** (primary, also double-click or Enter), **Change folder…**, **Open folder** (shows the folder in the Explorer) and **Cancel**.

## Data shapes

### Settings (schema 11): new section `templates`

| Field | Rust | TypeScript | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `my_folder` | `String` | `string` | `""` (none) | empty, or an absolute path of at most 1024 characters | empty, or passes `validate_absolute_path` and at most 1024 characters |

TypeScript normalization: a string that is empty or (at most 1024 characters and starting with a drive letter and `:\` or with `\\`) is kept; anything else gives `""`.

### Template catalog (`src/templates/catalog.ts`, mirrored in Rust `templates.rs`)

| Id | File (in `templates/builtin/<lang>/`) | Name key | Description key | Shown icon (`fileTile` of the file name) |
|---|---|---|---|---|
| `letter` | `letter.docx` | `templates.letter.name` | `templates.letter.description` | document |
| `report` | `report.docx` | `templates.report.name` | `templates.report.description` | document |
| `budget` | `budget.xlsx` | `templates.budget.name` | `templates.budget.description` | sheet |
| `invoice` | `invoice.xlsx` | `templates.invoice.name` | `templates.invoice.description` | sheet |
| `meetingNotes` | `meeting-notes.md` | `templates.meeting.name` | `templates.meeting.description` | code (Markdown) |
| `presentation` | `presentation.pptx` | `templates.presentation.name` | `templates.presentation.description` | generic |

The created file's name is the translated name plus the file's extension (for example "Carta.docx").

Blank kinds (`BLANK_KINDS`): `markdown` (`.md`, name key `files.newMarkdownName`, created empty), `csv` (`.csv`, `files.newCsvName`, empty), `document` (`blank.docx`, `files.newDocumentName`), `spreadsheet` (`blank.xlsx`, `files.newSpreadsheetName`), `presentation` (`blank.pptx`, `files.newPresentationName`).

### Tauri commands (`src-tauri/src/templates.rs`)

| Command | Arguments | Returns | Errors |
|---|---|---|---|
| `templates_list` | `lang: String` | `TemplateList`: `builtin` (list of `{ id, path }` for the files that exist), `blank` (list of `{ ext, path }`), `user` (list of `{ name, path }`), `user_folder` (`String`, the setting), `user_folder_missing` (bool) | `templates.bad_request`, `templates.other` |
| `template_create` | `template_path: String`, `dest_dir: String`, `name: String` | `String` (the new file's path, display form) | `templates.bad_request`, `templates.not_allowed` (the template is not in a template folder), `templates.not_found` (template or folder missing), `templates.invalid_name`, `templates.access_denied`, `templates.other` |
| `templates_pick_folder` | `title: String` | `Option<String>` | `templates.bad_request`, `templates.other` |

`lang`: `en` or `es` (`pseudo` and anything else give `en`).

### Commands

| Command id | Label key | Icon (lucide) | Runs |
|---|---|---|---|
| `explorer.newMarkdown` | `commands.newMarkdown` | `NotebookPen` | `newBlank("markdown")` |
| `explorer.newCsv` | `commands.newCsv` | `Table` | `newBlank("csv")` |
| `explorer.newDocument` | `commands.newDocument` | `FileText` | `newBlank("document")` |
| `explorer.newSpreadsheet` | `commands.newSpreadsheet` | `FileSpreadsheet` | `newBlank("spreadsheet")` |
| `explorer.newPresentation` | `commands.newPresentation` | `Presentation` | `newBlank("presentation")` |
| `explorer.newFromTemplate` | `commands.newFromTemplate` | `LayoutTemplate` | `newFromTemplate()` |

All: risk `change`, help slug `templates`, enabled when the location is a folder (the same rule as `explorer.newFolder`), no shortcut.

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `commands.newMarkdown` | Markdown note | Nota de Markdown |
| `commands.newCsv` | CSV table | Tabla CSV |
| `commands.newDocument` | Document | Documento |
| `commands.newSpreadsheet` | Spreadsheet | Hoja de cálculo |
| `commands.newPresentation` | Presentation | Presentación |
| `commands.newFromTemplate` | From template… | Desde plantilla… |
| `files.newMarkdownName` | New note.md | Nueva nota.md |
| `files.newCsvName` | New table.csv | Nueva tabla.csv |
| `files.newDocumentName` | New document.docx | Nuevo documento.docx |
| `files.newSpreadsheetName` | New spreadsheet.xlsx | Nueva hoja de cálculo.xlsx |
| `files.newPresentationName` | New presentation.pptx | Nueva presentación.pptx |
| `templates.title` | New from template | Nuevo desde plantilla |
| `templates.builtin` | Built-in templates | Plantillas integradas |
| `templates.mine` | My templates | Mis plantillas |
| `templates.mineEmpty` | Choose a folder: every file you keep in it becomes a template. | Elige una carpeta: cada archivo que guardes en ella será una plantilla. |
| `templates.mineMissing` | The folder {folder} can't be found. Choose another one. | No se encuentra la carpeta {folder}. Elige otra. |
| `templates.mineNone` | The folder {folder} has no files yet. Save a file there to use it as a template. | La carpeta {folder} todavía no tiene archivos. Guarda un archivo allí para usarlo como plantilla. |
| `templates.chooseFolder` | Choose folder… | Elegir carpeta… |
| `templates.changeFolder` | Change folder… | Cambiar carpeta… |
| `templates.openFolder` | Open folder | Abrir carpeta |
| `templates.folderTitle` | Choose the folder for your templates | Elige la carpeta de tus plantillas |
| `templates.create` | Create | Crear |
| `templates.letter.name` | Letter | Carta |
| `templates.letter.description` | A simple letter with your address and the recipient's. | Una carta sencilla con tu dirección y la del destinatario. |
| `templates.letter.yourName` | [Your name] | [Tu nombre] |
| `templates.letter.yourAddress` | [Your address] | [Tu dirección] |
| `templates.letter.date` | [Date] | [Fecha] |
| `templates.letter.recipientName` | [Recipient's name] | [Nombre del destinatario] |
| `templates.letter.recipientAddress` | [Recipient's address] | [Dirección del destinatario] |
| `templates.letter.greeting` | Dear [name], | Estimado/a [nombre]: |
| `templates.letter.body` | Write your letter here. | Escribe tu carta aquí. |
| `templates.letter.closing` | Kind regards, | Saludos cordiales, |
| `templates.report.name` | Report | Informe |
| `templates.report.description` | A report with a title page heading and four sections. | Un informe con título y cuatro secciones. |
| `templates.report.title` | Report title | Título del informe |
| `templates.report.byline` | [Author] · [Date] | [Autor] · [Fecha] |
| `templates.report.summary` | Summary | Resumen |
| `templates.report.introduction` | Introduction | Introducción |
| `templates.report.findings` | Findings | Resultados |
| `templates.report.conclusions` | Conclusions | Conclusiones |
| `templates.report.placeholder` | Write here. | Escribe aquí. |
| `templates.budget.name` | Budget | Presupuesto |
| `templates.budget.description` | Planned and actual spending by category, with totals. | Gastos previstos y reales por categoría, con totales. |
| `templates.budget.sheet` | Budget | Presupuesto |
| `templates.budget.category` | Category | Categoría |
| `templates.budget.planned` | Planned | Previsto |
| `templates.budget.actual` | Actual | Real |
| `templates.budget.difference` | Difference | Diferencia |
| `templates.budget.total` | Total | Total |
| `templates.budget.housing` | Housing | Vivienda |
| `templates.budget.food` | Food | Comida |
| `templates.budget.transport` | Transport | Transporte |
| `templates.budget.utilities` | Utilities | Servicios |
| `templates.budget.other` | Other | Otros |
| `templates.invoice.name` | Invoice | Factura |
| `templates.invoice.description` | An invoice that adds up its lines, tax and total. | Una factura que suma sus líneas, el impuesto y el total. |
| `templates.invoice.sheet` | Invoice | Factura |
| `templates.invoice.title` | Invoice | Factura |
| `templates.invoice.number` | Invoice number | Número de factura |
| `templates.invoice.date` | Date | Fecha |
| `templates.invoice.billTo` | Bill to | Facturar a |
| `templates.invoice.description2` | Description | Descripción |
| `templates.invoice.quantity` | Quantity | Cantidad |
| `templates.invoice.unitPrice` | Unit price | Precio unitario |
| `templates.invoice.amount` | Amount | Importe |
| `templates.invoice.subtotal` | Subtotal | Subtotal |
| `templates.invoice.tax` | Tax | Impuesto |
| `templates.invoice.total` | Total | Total |
| `templates.meeting.name` | Meeting notes | Notas de reunión |
| `templates.meeting.description` | Date, attendees, agenda, notes and action items. | Fecha, participantes, temas, notas y tareas. |
| `templates.meeting.title` | Meeting notes | Notas de la reunión |
| `templates.meeting.date` | Date | Fecha |
| `templates.meeting.attendees` | Attendees | Participantes |
| `templates.meeting.agenda` | Agenda | Temas |
| `templates.meeting.notes` | Notes | Notas |
| `templates.meeting.actions` | Action items | Tareas |
| `templates.meeting.actionItem` | Task, person, due date | Tarea, persona, fecha límite |
| `templates.presentation.name` | Simple presentation | Presentación sencilla |
| `templates.presentation.description` | A title slide, an agenda and a closing slide. | Una diapositiva de título, una de temas y una de cierre. |
| `templates.presentation.title` | Presentation title | Título de la presentación |
| `templates.presentation.byline` | [Your name] · [Date] | [Tu nombre] · [Fecha] |
| `templates.presentation.agenda` | Agenda | Temas |
| `templates.presentation.topic1` | First topic | Primer tema |
| `templates.presentation.topic2` | Second topic | Segundo tema |
| `templates.presentation.topic3` | Third topic | Tercer tema |
| `templates.presentation.thanks` | Thank you | Gracias |
| `templates.presentation.questions` | Questions? | ¿Preguntas? |
| `errors.templates.other` | Couldn't create the file. Try again. | No se pudo crear el archivo. Vuelve a intentarlo. |
| `errors.templates.bad_request` | That template can't be used. | Esa plantilla no se puede usar. |
| `errors.templates.not_allowed` | Only files from the template folders can be used as templates. | Solo se pueden usar como plantillas los archivos de las carpetas de plantillas. |
| `errors.templates.not_found` | The template or the folder no longer exists. | La plantilla o la carpeta ya no existe. |
| `errors.templates.invalid_name` | That name can't be used for a file. | Ese nombre no se puede usar para un archivo. |
| `errors.templates.access_denied` | You don't have permission to create files in this folder. | No tienes permiso para crear archivos en esta carpeta. |

(The key `templates.invoice.description2` holds the column title "Description"; `templates.invoice.description` is the catalog line.) After editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate.

### T1 - Template-building libraries (development only)

**Files:** modify `package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `docs/dependency-and-license-table.md`.

**Do this:** `plan/recipes/add-dependency.md` (npm, development only): `npm install docx@9.15.0 exceljs@4.4.0 pptxgenjs@4.0.1 --save-dev --save-exact`. Add the script `"templates": "node scripts/build-templates.mjs"` to `package.json` in T3 (not now). Records: `THIRD_PARTY_LICENSES.md`, a new section "Development tools (not shipped)" if missing, with "**docx** 9.15.0 (MIT), **exceljs** 4.4.0 (MIT), **pptxgenjs** 4.0.1 (MIT) - build the Office templates on the developer's PC (Step 06c). Not part of the app."; `docs/dependency-and-license-table.md`: one row each, marked "development only". `npm audit --omit=dev` must still report no high or critical issue (these are development packages).

**Commit:** `deps: add docx 9.15.0, exceljs 4.4.0, pptxgenjs 4.0.1 (MIT, development only) [step-06c/T1]`

### T2 - Settings: My templates folder (schema 11)

**Files:** modify `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/__tests__/settings.test.ts`, `scripts/measure-ui.ps1`, and any test file that builds `AppSettings` literally.

`plan/recipes/add-settings-field.md` with N = 11: a new section `templates` (`TemplateSettings` in Rust and TypeScript) after `versions`, in `impl Default for Settings` and `migrate_v1`; `migrate`'s arm "4 to 9" also takes 10. Tests: `settings_defaults` expects 11; `settings_v9_migrates_to_v10_keeping_language_and_theme` expects `CURRENT_SCHEMA`; new `settings_v10_migrates_to_v11_keeping_language_and_theme` (schema 10 with language `es`, theme mode `dark`, `versions.keep_days` 90: after `migrate` schema 11, those kept, `templates.my_folder` empty) and `settings_validate_rejects_bad_templates_folder` (`relative\folder` and 1025 letters fail; empty and `C:\Users\Ana\Templates` pass). TypeScript: schema 11; "keeps valid Explorer view options and repairs invalid ones" expects 11 and the `templates` section; new test "normalizes the templates folder (schema 11)": `{}` gives `""`; `C:\T` kept; `\\srv\share\T` kept; `relative` gives `""`; 5 gives `""`. `measure-ui.ps1`: schema 11 and `templates = @{ my_folder = "" }` (P-32).

**Commit:** `feat(settings): My templates folder (schema 11) [step-06c/T2]`

### T3 - The templates and their build script

**Files:** create `scripts/build-templates.mjs`, `templates/README.md`, every file the script writes under `templates/`; modify `package.json` (the `templates` script), `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `templates.<template>.*` key (names, descriptions and contents).

**Do this (`scripts/build-templates.mjs`):** an ESM Node script (header comment "Builds the Office and Markdown templates from the templates.* texts of en.json and es.json (Step 06c). Run: npm run templates. Development only."). It reads both locale files as JSON, and for each language `en` and `es` writes into `templates/builtin/<lang>/` (creating folders):

| File | How (library) | Content |
|---|---|---|
| `letter.docx` | `docx`: `new Document({ creator: "Adperastra", title: <letter.name>, sections: [{ children }] })`, `Packer.toBuffer` | paragraphs, in order: `yourName` (bold `TextRun`), `yourAddress`, `date`, an empty paragraph, `recipientName`, `recipientAddress`, an empty paragraph, `greeting`, `body`, an empty paragraph, `closing`, `yourName` |
| `report.docx` | `docx` (as above) | `title` as a paragraph with `heading: HeadingLevel.TITLE`; `byline`; then for `summary`, `introduction`, `findings`, `conclusions`: a `HEADING_1` paragraph and a `placeholder` paragraph |
| `budget.xlsx` | `exceljs` (default import `ExcelJS`; the package is CommonJS): `new ExcelJS.Workbook()`, `creator` "Adperastra", `addWorksheet(<budget.sheet>)`, `xlsx.writeBuffer` | columns `category` (width 24), `planned` (14), `actual` (14), `difference` (14) with the four header texts; rows for `housing`, `food`, `transport`, `utilities`, `other` with 0, 0 and a formula `B<n>-C<n>` in the difference column; then a `total` row with `SUM(B2:B6)`, `SUM(C2:C6)`, `SUM(D2:D6)`; the header row and the total row bold; number format `#,##0.00` on columns B to D |
| `invoice.xlsx` | `exceljs` | sheet `<invoice.sheet>`: A1 `title` (bold, font size 16); A3 `number`, A4 `date`, A5 `billTo` (B3 to B5 empty for the user); row 7 the column titles `description2`, `quantity`, `unitPrice`, `amount` (bold); rows 8 to 12 empty description, quantity and unit price, and the amount formula `B<n>*C<n>`; D14 `SUM(D8:D12)` with C14 `subtotal`; C15 `tax` with D15 `0`; C16 `total` with D16 `D14+D15` (bold); number format `#,##0.00` on C8:D16; column widths 32, 12, 14, 14 |
| `meeting-notes.md` | plain text (UTF-8, `\n`) | `# <meeting.title>`, empty line, `**<meeting.date>:** `, `**<meeting.attendees>:** `, empty line, `## <meeting.agenda>`, empty line, `1. `, empty line, `## <meeting.notes>`, empty line, empty line, `## <meeting.actions>`, empty line, `- [ ] <meeting.actionItem>`, and a final line break |
| `presentation.pptx` | `pptxgenjs` (default import): `new pptxgen()`, `layout = "LAYOUT_WIDE"`, `author` "Adperastra", `title` <presentation.name>; `write({ outputType: "nodebuffer" })` (cast the result to a Buffer) | slide 1: `title` (x 0.6, y 2.4, w 12, h 1.2, font size 40, bold) and `byline` (x 0.6, y 3.7, w 12, h 0.6, font size 20); slide 2: `agenda` (x 0.6, y 0.5, w 12, h 0.9, font size 32, bold) and the three topics as one text box with bullets (x 0.9, y 1.6, w 11, h 3, font size 24); slide 3: `thanks` (x 0.6, y 2.6, w 12, h 1.2, font size 40, bold) and `questions` (x 0.6, y 3.9, w 12, h 0.6, font size 24) |

It also writes `templates/blank/blank.docx` (a document with one empty paragraph), `blank.xlsx` (one empty worksheet named "Sheet1") and `blank.pptx` (one empty slide, `LAYOUT_WIDE`), and prints each path it wrote. Then run `npm run templates` and commit the generated files. `templates/README.md` says in two sentences that the files are generated by `npm run templates` from the `templates.*` texts and must be regenerated when those texts change.

**Tests:** in `src/__tests__/templates.test.ts` (new): "every built-in template exists in both languages": for each catalog entry (T5 creates the catalog; in this task write the list of the six file names in the test itself) and each of `en`, `es`, the file `templates/builtin/<lang>/<file>` exists (`node:fs`) and is not empty; the three blank files exist; "the Markdown template uses the translations": `templates/builtin/es/meeting-notes.md` starts with `# Notas de la reunión`.

**Traps:**
- The generated Office files contain the build time, so they change on every run: run the script only when a `templates.*` text changes.
- `docx` requires `sections` and each section's `children`; `HeadingLevel` is a constant object, not an enum (use `HeadingLevel.HEADING_1`).

**Commit:** `feat(templates): built-in templates in English and Spanish [step-06c/T3]`

### T4 - Templates in Rust: list, create, choose a folder

**Files:** create `src-tauri/src/templates.rs`, `src/services/templates.ts`; modify `src-tauri/src/main.rs`, `src-tauri/src/file_dialogs.rs`, `src-tauri/isolation/index.html`, `src-tauri/tauri.conf.json`, `scripts/package-app.ps1`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every `errors.templates.*` key.

**Do this:**
1. `tauri.conf.json`: `bundle.resources` gets `"../templates": "templates"` next to the help entry. `package-app.ps1`: after the line that copies `help`, copy `templates` the same way.
2. `file_dialogs.rs`: a new crate-visible `pick_folder_path(owner: isize, title: &str) -> Result<Option<String>, String>`: the open dialog with the extra option `FOS_PICKFOLDERS` (and `FOS_FORCEFILESYSTEM`, `FOS_PATHMUSTEXIST`), no file types; same COM pattern and errors as the other two.
3. `templates.rs` (module doc comment "Templates for the New menu (Step 06c): built-in files shipped with the app and the user's own folder."):
   - Constants: `BUILTIN` (the six `(id, file)` pairs of the catalog), `BLANK` (`("docx", "blank.docx")`, `("xlsx", "blank.xlsx")`, `("pptx", "blank.pptx")`), `MAX_USER_TEMPLATES` 200.
   - `template_roots(app)`: like `help_roots` in `main.rs` but for `templates` (the resource folder's `templates`, then the folders next to the executable, then `./templates`).
   - Pure `template_lang(lang: &str) -> &'static str`: `es` gives `es`; anything else `en`.
   - Pure `is_inside(root: &Path, path: &Path) -> bool`: both canonicalized (`fs::canonicalize`; a failure gives false); true when the path starts with the root and is not the root.
   - Pure `list_user_templates(folder: &Path) -> Result<Vec<UserTemplate>, String>`: the regular files directly in the folder, skipping hidden and system ones (through `fs_service`'s listing or the file attributes), sorted with `fs_service::natural_cmp` on the name, at most `MAX_USER_TEMPLATES`; a missing folder gives `templates.not_found`.
   - Pure `copy_template(template: &Path, dest_dir: &Path, name: &str) -> Result<PathBuf, String>`: `fs_service::validate_new_name(name)` (else `templates.invalid_name`); `dest_dir` must be a folder (else `templates.not_found`); the target is `fs_service::unique_destination(dest_dir, name)`; copy to the target's partial name (`fs_service::partial_path`), clear the Read-only attribute on it, rename it to the target; on failure remove the partial file; access denied gives `templates.access_denied`, others `templates.other`.
   - Commands (async, `ensure_main`, `spawn_blocking` for disk work): `templates_list(lang)` (finds the first root that has `builtin/<lang>` or falls back to `builtin/en`; lists the built-in and blank files that exist; reads `templates.my_folder` from the settings (lock released before work); `user_folder_missing` when it is set but not a folder); `template_create(template_path, dest_dir, name)` (both paths `validate_absolute_path` and the name at most 255 characters, else `templates.bad_request`; the template must be `is_inside` one of the roots' `builtin` or `blank` folders, or inside the settings' My templates folder, else `templates.not_allowed`; then `copy_template`; returns the display path); `templates_pick_folder(title)` (title 1 to 200 characters; `file_dialogs::pick_folder_path` with the owner window; `dialog.failed` gives `templates.other`).
   - Tests at the bottom (tempdir): `lang_falls_back_to_english` (`es`, `en`, `pseudo`, `fr` give `es`, `en`, `en`, `en`); `is_inside_needs_a_real_child` (a file in the root: true; the root itself: false; a sibling folder: false; a path with `..` that leaves the root: false); `copy_template_never_overwrites` (copy `t.docx` as `Letter.docx` twice into a folder: `Letter.docx` and `Letter (2).docx`; both equal the template's bytes; no `.partial` left); `copy_template_clears_read_only` (a read-only template: the copy is not read-only); `user_templates_skip_hidden_files_and_folders` (a folder with `a.txt`, `B.docx`, a hidden `h.txt` and a sub-folder: names `a.txt`, `B.docx`).
4. `main.rs`: `mod templates;`; register the three commands; `ALLOWED` gets them.
5. `src/services/templates.ts`: interfaces `TemplateList`, `BuiltinTemplateFile`, `BlankTemplateFile`, `UserTemplate` (snake_case) and `templatesList(lang)`, `templateCreate(templatePath, destDir, name)`, `templatesPickFolder(title)`; outside Tauri: an empty list (`user_folder` "", `user_folder_missing` false), and `null` for the folder picker; `templateCreate` rejects with `templates.other`.

**Commit:** `feat(templates): list templates, create from a template, choose a folder [step-06c/T4]`

### T5 - The catalog and the New menu

**Files:** create `src/templates/catalog.ts`, `src/templates/createNew.ts`, `src/__tests__/templateCatalog.test.ts`, `help/en/templates.md`, `help/es/templates.md` (exact texts in "Help pages"; the commands' help slug needs them in this task); modify `src/commands/explorerCommands.ts`, `src/commands/menus.ts`, `src/views/ExplorerHome.tsx`, `src/__tests__/commands.test.ts`, `src/__tests__/templates.test.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** the six `commands.new*` keys and the five `files.new*Name` keys of this step.

**Do this:**
1. `catalog.ts` (doc comment "Built-in templates and blank file kinds (Step 06c). Same ids as Rust templates.rs."): `BuiltinTemplateId`, `BUILTIN_TEMPLATES` (the catalog table: `id`, `file`, `nameKey`, `descriptionKey`), `BlankKind`, `BLANK_KINDS` (Data shapes: `kind`, `ext`, `nameKey`, `blankFile` (`null` for `markdown` and `csv`)), and the pure `templateFileName(nameText: string, file: string)`: the name text plus the file's extension (from the last dot of `file`).
2. `createNew.ts` (doc comment "Creating new files for the New menu (Step 06c)."): `createBlank(kind, destDir, t, lang)` returns `Promise<string>` (the new path): for `markdown` and `csv` `createItem(destDir, t(nameKey), "file")`; for the Office kinds, `templatesList(lang)`, the blank entry whose `ext` matches, then `templateCreate(its path, destDir, t(nameKey))` (no blank file found: reject with `templates.not_found`). `createFromTemplate(templatePath, destDir, name)` returns `templateCreate(...)`.
3. `explorerCommands.ts`: `ExplorerActions` gains `newBlank(kind: BlankKind)` and `newFromTemplate()` (comment "Step 06c"); the six commands of the Commands table after `explorer.newTextFile`. `menus.ts`: `NEW_MENU` becomes `newFolder`, `newTextFile`, `newMarkdown`, `newCsv`, `newDocument`, `newSpreadsheet`, `newPresentation`, a separator, `newFromTemplate`.
4. `ExplorerHome.tsx` (about 30 lines): a helper `recordCreated(path)` holding today's tail of `createNew` (the undo entry with `toast.created`, `notifyAction`, `pendingRenameRef`, `refreshAfterOp`), used by `createNew` too (`createNew` keeps its behavior). The action `newBlank(kind)`: when the location is a folder and in Tauri, `createBlank(kind, folder, t, i18n.language)` then `recordCreated`; errors through `notifyOpError` for `ops.*` codes and `notifyError(error, "templates")` for `templates.*` codes. The action `newFromTemplate` sets a state `templatePickerOpen` (T6 draws the window; until then nothing visible happens).

**Tests:**
- `templateCatalog.test.ts`: "templateFileName keeps the extension" ("Carta", `letter.docx` gives `Carta.docx`; "Notas", `meeting-notes.md` gives `Notas.md`); "ids match the files" (six built-ins with the table's files; five blank kinds, `markdown` and `csv` with no blank file).
- `templates.test.ts`: the file list of T3 now comes from `BUILTIN_TEMPLATES` (same assertions).
- `commands.test.ts`: add "the New menu creates files": the six new commands exist, have help slug `templates`, are enabled with location `folder` and disabled with `home`; running `explorer.newDocument` calls `newBlank("document")`; `NEW_MENU`'s command ids are in the order of step 3. (Add `newBlank` and `newFromTemplate` spies to the test's actions object.)

**Commit:** `feat(explorer): New menu with Markdown, CSV and Office files [step-06c/T5]`

### T6 - The template window

**Files:** create `src/templates/TemplatePickerDialog.tsx`, `src/styles/templates.css`, `src/__tests__/templatePicker.test.tsx`; modify `src/views/ExplorerHome.tsx`, `src/App.tsx`, `src/main.tsx` (import `./styles/templates.css` after `./styles/versions.css`), `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** every remaining `templates.*` key (`title`, `builtin`, `mine`, `mineEmpty`, `mineMissing`, `mineNone`, `chooseFolder`, `changeFolder`, `openFolder`, `folderTitle`, `create`).

**Do this (`TemplatePickerDialog.tsx`):** the default export takes `lang` (string), `onCreate` (function taking the template path and the file name to create), `onFolderChange` (function taking the chosen folder path), `onOpenFolder` (function taking a folder path), `onClose`.
1. On mount: `templatesList(lang)`; a skeleton (rows, 3) after 0.1 s while waiting.
2. Inside `Dialog` (title `templates.title`; extra class `adp-templates-dialog`): two sections, each an `h3` (class `adp-heading`) and a list (`ul`, `role="listbox"`, `aria-label` = the heading): **Built-in templates**: one `li` (`role="option"`, `aria-selected`) per `BUILTIN_TEMPLATES` entry that `templatesList` returned, with the file tile (`fileTile(file name)`, 16 px icon), the translated name, and the description in a secondary line; **My templates**: one `li` per user template with its tile and file name; or a note: `templates.mineEmpty` when no folder is set, `templates.mineMissing` (with `folder`) when it is missing, `templates.mineNone` (with `folder`) when it has no files.
3. One selection across both lists (the first built-in template starts selected); arrow keys move within a list; Enter or a double-click creates.
4. Buttons (`div.adp-dialog-actions`): at the left `templates.chooseFolder` (no folder set) or `templates.changeFolder` (set), which calls `templatesPickFolder(t("templates.folderTitle"))` and, with a result, `onFolderChange(path)` and lists again; `templates.openFolder` (only when a folder is set and exists) calling `onOpenFolder(folder)`; at the right `common.cancel` and the primary `templates.create`, which calls `onCreate(path, name)` with name = `templateFileName(t(nameKey), file)` for built-ins or the file's own name for My templates, then closes.

**Do this (`ExplorerHome.tsx`, about 20 lines):** two new optional props `templatesFolder` (string, default "") and `onTemplatesFolderChange` (function taking the path); when `templatePickerOpen`, render the dialog with `lang` = the i18n language, `onCreate` = `createFromTemplate(path, current folder, name)` then `recordCreated` (errors as in T5), `onFolderChange` = `onTemplatesFolderChange`, `onOpenFolder` = `goToFolder`, `onClose` clearing the state. `App.tsx` passes `templatesFolder` = `settings.templates.my_folder` and `onTemplatesFolderChange` (applies the settings with the new folder).

**Do this (`templates.css`):** comment "Template window (Step 06c). Colors only through tokens."; `.adp-templates-dialog` (width min(640 px, 92 vw)); the lists (flex column; gap 2 px; vertical overflow auto; max height 260 px; border 1 px `--adp-color-border-panel`; corner radius `--adp-radius-md`; padding `--adp-space-1`); list rows (flex row, items centered; gap `--adp-space-3`; padding `--adp-space-2` `--adp-space-4`; corner radius `--adp-radius-sm`; pointer cursor; selected: background `--adp-color-surface-selected-row`; the description: text `--adp-color-text-secondary`, font size `--adp-font-small`).

**Tests** (`src/__tests__/templatePicker.test.tsx`; mock `../services/templates`):

| Test | Steps | Expected |
|---|---|---|
| "lists the built-in templates in the app language" | `templatesList` resolves all six built-ins and no user folder | 6 options with "Letter", "Report", "Budget", "Invoice", "Meeting notes", "Simple presentation"; the note `templates.mineEmpty`; a `templates.chooseFolder` button; no Open folder button |
| "creates the selected template" | select "Budget"; click Create | `onCreate` with the budget path and `Budget.xlsx`; `onClose` called |
| "Enter and double-click create" | press Enter on the first option; double-click "Invoice" (render again) | `onCreate` with `Letter.docx`; then with `Invoice.xlsx` |
| "my templates come from the folder" | user folder `C:\T` with `Offer.docx`; select it; Create | the option "Offer.docx"; `onCreate` with its path and `Offer.docx`; the buttons `templates.changeFolder` and `templates.openFolder` exist |
| "choosing a folder saves it" | click Choose folder…; `templatesPickFolder` resolves `C:\T` | `onFolderChange("C:\\T")`; `templatesList` called again |
| "a missing folder says so" | `user_folder_missing` true | the text of `templates.mineMissing` with the folder |

**Commit:** `feat(templates): template window with built-in templates and My templates [step-06c/T6]`

### T7 - Speed and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

**Do this:**
1. The step value `06b` becomes `06c`.
2. In the full mode, after Step 06b's measurements, a `measure` named `command bar New menu (with templates)`: setup nothing; action clicks `window.__m.menuButton(0)`; cleanup closes the menus. (The existing "command bar New menu" measurement stays; both must stay Instant.)
3. Screenshots, after Step 06b's last action: click `window.__m.menuButton(0)`, wait 200 ms, shot `44-new-menu`; click the last menu item (From template…), wait 600 ms, shot `45-template-window`; press Escape.

**Commit:** `test(speed): New menu and template window screenshots [step-06c/T7]`

## Help pages

### New page `help/en/templates.md` (exact text)

```markdown
# New files and templates

Create new files right in the open folder, empty or from a template.

## Create a new file

1. Open the folder where the file should go.
2. Click **New** in the command bar (or right-click an empty part of the folder and choose **New**).
3. Choose **New folder**, **Text file**, **Markdown note**, **CSV table**, **Document**, **Spreadsheet** or **Presentation**.
4. The new file appears with its name selected: type a name and press **Enter**.

**Ctrl+Z** removes the new file again (it goes to the Recycle Bin).

## Use a template

1. Click **New** > **From template…**.
2. Choose a template: **Letter**, **Report**, **Budget**, **Invoice**, **Meeting notes** or **Simple presentation**. They're in the app's language.
3. Click **Create** (or press **Enter**, or double-click the template).

## My templates

- In the template window, click **Choose folder…** and pick a folder. Every file you keep in that folder appears under **My templates**: a letterhead, a form, a spreadsheet you reuse.
- **Change folder…** picks another folder; **Open folder** shows it in the Explorer, so you can add or remove templates.
- Creating from one of your templates makes a copy; the template itself never changes.

## Good to know

- Documents, spreadsheets and presentations open in the Windows app you use for them, until Adperastra can open them itself.
- If a file with the same name already exists, the new one gets a number, like "New note (2).md". Nothing is ever replaced.

See also: "Editing text and code" and "The command bar".
```

### New page `help/es/templates.md` (exact text)

```markdown
# Archivos nuevos y plantillas

Crea archivos nuevos directamente en la carpeta abierta, vacíos o a partir de una plantilla.

## Crear un archivo nuevo

1. Abre la carpeta donde debe ir el archivo.
2. Haz clic en **Nuevo** en la barra de comandos (o haz clic derecho en una parte vacía de la carpeta y elige **Nuevo**).
3. Elige **Nueva carpeta**, **Archivo de texto**, **Nota de Markdown**, **Tabla CSV**, **Documento**, **Hoja de cálculo** o **Presentación**.
4. El archivo nuevo aparece con su nombre seleccionado: escribe un nombre y presiona **Entrar**.

**Ctrl+Z** vuelve a quitar el archivo nuevo (va a la Papelera de reciclaje).

## Usar una plantilla

1. Haz clic en **Nuevo** > **Desde plantilla…**.
2. Elige una plantilla: **Carta**, **Informe**, **Presupuesto**, **Factura**, **Notas de reunión** o **Presentación sencilla**. Están en el idioma de la aplicación.
3. Haz clic en **Crear** (o presiona **Entrar**, o haz doble clic en la plantilla).

## Mis plantillas

- En la ventana de plantillas, haz clic en **Elegir carpeta…** y elige una carpeta. Cada archivo que guardes en ella aparece en **Mis plantillas**: un membrete, un formulario, una hoja de cálculo que reutilizas.
- **Cambiar carpeta…** elige otra carpeta; **Abrir carpeta** la muestra en el Explorador, para que puedas agregar o quitar plantillas.
- Crear a partir de una de tus plantillas hace una copia; la plantilla nunca cambia.

## Para tener en cuenta

- Los documentos, las hojas de cálculo y las presentaciones se abren en la aplicación de Windows que usas para ellos, hasta que Adperastra pueda abrirlos por sí misma.
- Si ya existe un archivo con el mismo nombre, el nuevo recibe un número, como "Nueva nota (2).md". Nunca se reemplaza nada.

Consulta también: «Editar texto y código» y «La barra de comandos».
```

## Check by hand (the owner, in the packaged app)

Use any folder you can write to (for example `%TEMP%\adp-06c`, an empty folder you create) and a second folder with two of your own files for My templates.

1. **New** lists the nine entries with the separator before **From template…**; on the Home page they are disabled.
2. Create each blank kind: each appears with its name selected; rename it; Ctrl+Z sends it to the Recycle Bin; Ctrl+Y brings it back.
3. Create two Markdown notes: the second is "New note (2).md". Double-click a `.md`: it opens in a tab and can be edited. Double-click the `.docx`, `.xlsx` and `.pptx`: they open in their Windows apps (or Windows asks which app) and show an empty document.
4. **From template…**: six templates with descriptions. Create each: the Budget and Invoice add up when numbers are typed in their Windows app; the Meeting notes open in a tab.
5. Switch the app to Spanish: the window, the template names and the files' contents are in Spanish ("Carta.docx", "Notas de reunión.md").
6. **Choose folder…** your second folder: its files appear under My templates; create from one: a copy appears; the original is unchanged. **Open folder** shows that folder. Rename the folder in Windows Explorer and reopen the window: the missing-folder note and **Change folder…**.
7. Restart the app: the My templates folder is remembered.
8. Repeat checks 1 and 4 in the dark theme.

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Open the New menu | Instant (0.1 s) | `command bar New menu (with templates)` |
| Create a blank file or a file from a template | Fast (1 s) | by hand (checks 2 and 4) |
| Open the template window | Fast (1 s) | by hand (check 4) |
| Every existing measurement | as before | not more than 20% slower than step 06b's JSON |

## Screenshots

`44-new-menu`, `45-template-window` (added in T7), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-06c/`.

## Done when

- [ ] T1 to T7 are committed, each after `GATE PASSED`.
- [ ] The New menu creates every blank kind with a translated, unique name, an undo entry and the rename box.
- [ ] The six built-in templates exist in English and Spanish, built from the translation files, and create correct files.
- [ ] My templates works from a chosen folder, remembered after a restart; Rust copies only from template folders.
- [ ] Settings schema 11 loads a schema-10 file without losing anything (Rust test `settings_v10_migrates_to_v11_keeping_language_and_theme`).
- [ ] The speed table rows meet their tiers; the screenshots exist; the step report is written.
