# Step 09e: Bulk rename and batch actions

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09e-bulk-actions |
| Tag | v0.1.5-step09e |
| Depends on | 07b metadata-preview-1;08a conversion-2;08b conversion-presets-1;08c privacy-1;09d palette-1 |
| Written before | 07a was built |
| Interface revision | bulk-rename-1; batch-actions-1 |

Guide only. Workers write source/tests/help without running them. Coordinator installs pinned dependencies, edits shared roots, executes checks and commits verified work. No user-file mutation occurs during guide authoring.

## Goal and exclusions

Preview and rename up to1,000 selected items with deterministic operations, exclusions, conflict checks and one history entry. Reuse rename presets and run existing conversion/privacy presets on the selection. No filesystem replacement, automatic metadata writing, custom scripts, AI, recursive folder contents renaming or permanent deletion.

## Read first / dependencies

Mapped v1 09b bulk rename/batch actions; full08a-c/09a/09d; current fs-service rename/name validation/owned_io; transfer-history and Undo types; native jobs;07b metadata values. Pin regex1.13.1, MIT OR Apache-2.0, Rust1.65, defaultfeatures off with std/perf/unicode; coordinator verifies these feature names against exact crate metadata and records them before installation. API RegexBuilder::new/size_limit/dfa_size_limit/build, Regex::replace_all/Captures checked from primary docs; no JS regex execution.

| ID | Producer/task; exact export | Use |
|---|---|---|
| U1 | 07a T2/E3 SourceStamp/CacheService.source_stamp;07b T2/E1 MetadataInfo | Source full-resolution stamp and fixed metadata field IDs date_taken/camera_model/width/height; metadata fetched only for explicitly requested placeholders |
| U2 | 03b fs-service validate_new_name; owned_io PinnedDirectory/PinnedSource | Name validation and pinned parent chains; mutation handles defined here are separate from read-only PinnedSource |
| U3 | 06d jobs.rs JobContext/spawn_job,services/jobs.ts runJob/JobHandle.completion | Plan/execute use shared jobs, cancellation and progress, no separate polling table |
| U4 | 08b E4 applyConversionPreset;08a E2 startConversion;08c E1 inspectPrivacy/cleanPrivacy | Exact input/option/report types imported, no second conversion/cleaner implementation |
| U5 | 03b UndoStack/FileAction/executeFileAction;09a E9UiHistoryRegistry | File rename effects use new E5 native receipt; app-state presets use validated UI-history adapter, no mutable-source Redo reconstruction |
| U6 | 09d E3 PaletteRegistry; CommandRegistry/JobsPanel | Register compatible multi-selection actions and translated summaries; enabledWhen checked at dispatch |

## Decisions / algorithm

1. Input order is current displayed selection order, retained in plan. Files/folders can be selected together, but selecting an ancestor and descendant is refused before mutation. Maximum1,000 sources/10MiB serialized plan; path cap32,768UTF16; one executing rename batch at a time. Never follow reparse points or rename protected roots/system directories.
2. Separate stem and final extension for files; leading-dot-only names have empty extension and whole-name stem. Folder names have no extension. `include_extension` false default. Apply operations in array order; preserve extension afterward. Number index is selection position among included rows, independent of excluded rows; start0..1,000,000,step1..1,000,000,padding1..12; checked arithmetic, overflow invalid.
3. Operations: literal replace, linear-time regex replace, prefix/suffix, numbering, Unicode lower/upper/title case, metadata/date token insertion, remove selected characters. No locale-dependent case unless explicitly selected locale in plan; use Unicode default mappings and title words separated by whitespace/hyphen/underscore. Expanded result must pass Windows name checks and255UTF16component length. Regex pattern<=4096UTF8bytes, compiledsize<=1MiB/DFAcache1MiB; reject unsupported backreferences/lookaround. Replacement supports literal and capture-index tokens only; no evaluation.
4. Metadata template tokens exactly stem,ext,index,date_modified,date_taken,camera_model,width,height. Token syntax braces; unknown/unavailable token produces invalid row, not blank text. Date format fixed UTC YYYY-MM-DD unless `date_zone` local explicitly chosen; local zone ID captured once. Invalid filename characters from metadata replaced by underscore, repeated underscores collapsed, trim trailingdot/space, then validate. Preview shows this normalization.
5. Preview debounces150ms and cancels older generation. Native derives stamps and computes target names; return pages200rows/768KiB with source/newname/status unchanged/ready/excluded/invalid/conflict and stable reason. Case-insensitive target collision per parent uses Windows ordinal-insensitive comparison; do not use simple lowercase to prove filesystem uniqueness. Existing item not in plan is a conflict. Case-only rename and A↔B cycles are allowed through owned intermediate names.
6. Plan stores validated requests/stamps, not an authorization to overwrite. Before execute, pin parent chains and acquire DELETE-capable mutation handles to every included source, sharing READ only; check identity against full stamp on the same handles. If any required handle/target validation fails, do no mutations and return rename.changed/in_use. At most1,000 held handles. Keep parent guards/handles until commit or recovery report completed.
7. Durable journal `<data>/rename-journals/<planUUID>.json` records original/current/target path plus volume/fileID for each source, state prepared/renaming/committed/recovery_required, before first mutation and after each successful handle rename. Every syscall additionally has a durable intent row with exact preselected random intermediate/final name, old/new candidatepaths, sourcevolume/fileID, sequence and state intent/completed. Flush intent before syscall, then completion after it. On crash between syscall and completion, recover only by matching recorded objectidentity among that intent's old/new candidatepaths; never scan-and-delete unknown temporarynames. Atomic app-state writes, max10MiB, total128MiB/100unfinished plans; reserve before mutation. Journal contains paths only, no file contents; sensitive virtual paths are unsupported here.
8. Rename all included sources to exclusive random sibling `~adp-rename-<UUID>` names via SetFileInformationByHandle with no-replace flags, then to final names via their owned handles. No path-only rename/delete and no replace flags. Intermediate source objects remain user data: never delete them as staging cleanup. On cancel/failure, attempt reverse handle renames in reverse effect order with no-replace; if an original location is occupied, retain the source at its actual current name, report recovery_required and keep journal. Do not overwrite a newly appeared foreign item to roll back.
9. Execution report contains actual effects, not assumed all-or-nothing. One Undo entry references the exact native journal/identity receipt; inverse execution revalidates all objects and uses same no-replace cycle algorithm. Redo renames those same objects only. Unknown/changed receipt fails without advancing global cursor. No promise that external edits/moves can always be undone.
10. Rename presets live in atomic `<data>/rename-presets.json`, schema1,100entries/1MiB; UUID/name1-60,operations only, no source paths or secrets. Save/remove via revision compare and09aUiHistoryRegistry. No settings bump; incoming/outgoing22.
11. BatchActionRegistry is a static adapter over existing converter/cleaner commands. Inputs remain immutable snapshot/file references, failures listed per item, completed effects never repeated on Retry. Privacy still requires inspection/category disclosure; preset is not permission to skip safety confirmation. Generic batch command cannot synthesize arbitrary command IDs from user text.

## Data and exports

Canonical Rust `crates/bulk-rename/src/types.rs`; TS `src/services/bulkRename.ts`; batch registry `src/batch/registry.ts`. Existing fs mutation helpers remain coordinator-owned.

| Type | Exact fields/variants |
|---|---|
| RenameOperation | tagged replace {find string,replacement string,regex boolfalse,match_case booltrue}; prefix {text}; suffix {text}; number {start u32,step u32,padding u8,position prefix/suffix,separator string<=16}; case {mode lower/upper/title}; template {pattern string<=512}; remove {characters string<=256}; explicit_names {names ExplicitRenameName[]}. Each text field <=4096, operations1-32; explicit_names must be the sole operation |
| ExplicitRenameName | input_index u32; new_name string1-255 UTF-16 units. At most1000 entries, unique indices, exactly the included request indices; full basename including extension. Native validates each Windows component without silently rewriting it |
| RenameRequest | paths string[]1-1000;operations RenameOperation[];include_extension boolfalse;excluded_indices u32[]unique;date_zone utc/local defaultutc;request_revision u32 |
| RenamePreviewRow | input_index u32;source_path string;source SourceStamp;old_name string;new_name string;status unchanged/ready/excluded/invalid/conflict;reason optionalcode |
| RenamePlanPage | plan_id UUID;request_revision u32;rows RenamePreviewRow[]max200;next_cursor optionalUUID;total/ready/invalid/conflicts u32;expires_unix safeu64 now+300;all_rows_valid bool |
| RenameEffect | source SourceStamp;original_path/current_path/target_path strings;status renamed/rolled_back/recovery_required;reason optionalcode |
| RenameReport | receipt_id UUID;effects RenameEffect[]max200/page;next_cursor optionalUUID;done/failed/excluded u32;cancelled bool;recovery_required bool;complete bool; actual current paths returned for journal recovery |
| RenamePreset | id UUID;name1-60;operations RenameOperation[];include_extension bool;date_zone utc/local;version1 |
| RenamePresetCatalog | schema_version1;revision safeu64;presets RenamePreset[]max100 |
| BatchActionSpec | id convert_preset/privacy_clean;label_key string;accepts(inputs readonlyConversionInput[])->boolean;run(inputs,options BatchActionOptions)->Promise<JobHandle<ConversionReport>> |
| BatchActionOptions | tagged convert_preset {preset_id UUID,dest_dir string,naming_date_utc string};privacy_clean {request PrivacyRequest}. Do not mix converter/privacy optiontypes |

| ID | Exact export | Signature; consumers |
|---|---|---|
| E1 | services/bulkRename.ts previewRename/renamePreviewPage | previewRename(request RenameRequest)->Promise<JobHandle<RenamePlanPage>> via rename_preview_start(request_id,request); renamePreviewPage(cursor string)->Promise<RenamePlanPage> via rename_preview_page(cursor). New preview invalidates only that request generation, not another window's plan |
| E2 | same executeRename/renameReportPage/releaseRenamePlan | executeRename(planId string,requestRevision number)->Promise<JobHandle<RenameReport>>; native rename_execute_start(request_id,plan_id,request_revision); page(cursor)->Promise<RenameReport>; release(id)->Promise<void>; commands rename_report_page/rename_plan_release |
| E3 | same listRenamePresets/writeRenamePreset/removeRenamePreset | list()->Promise<RenamePresetCatalog>;write(preset,expectedRevision)->Promise<catalog>;remove(id,expectedRevision)->Promise<catalog>; native rename_presets_list/rename_preset_write/rename_preset_remove |
| E4 | src/rename/BulkRenameDialog.tsx | props paths readonlystring[],onClose()->void,onCompleted(report RenameReport)->void,onOpenHelp(slug)->void; readonly results retain plan until close |
| E5 | native rename_history.rs RenameHistory.apply | (receipt_id &str,reverse bool,context &JobContext)->Result<RenameReport,String>; FileAction type bulkRename {id string,reverse boolean}; no snapshots or external callbacks serialized |
| E6 | batch/registry.ts registerBatchAction/resolveBatchAction | register(spec BatchActionSpec)->void rejects duplicate;resolve(id string)->BatchActionSpec|null; only two static IDs above until a reviewed extension.09g/11b/10e |

Error codes rename.bad_request/invalid_name/conflict/changed/in_use/too_large/regex/metadata_missing/journal_failed/recovery_required/cancelled/failed. Every command ensure_main/validaterequest/path/IDs before job reservation. Plan/cursor/report maps bounded32/5min; expired plans release handles except retained unfinished journal/history. No current native method is falsely claimed to provide handle-safe batchrename: T3 below creates it.

### Explicit names for reviewed AI proposals (E7)

17c consumes the same preview/execute pipeline using RenameOperation kind explicit_names. Its names array has exactly one ExplicitRenameName per included input_index, in original selection order; excluded indices have no entry. Reject missing, extra, duplicate or out-of-range indices, another operation in the array, and include_extension=true (the supplied name is already the full component). Do not run case/template/numbering or append an extension to these names. Native preview still derives SourceStamp, validates every name, detects target collisions/cycles and requires a fresh execute against that plan. AI text never directly mutates paths; explicit_names is also usable by trusted manual integrations. Rename presets reject explicit_names because names depend on a particular source selection.

T1 adds explicit_names_exact_coverage, explicit_names_duplicate_index_refused, explicit_names_exclusive, explicit_names_keeps_full_extension, explicit_names_preset_refused. T2/T3 run the same changed-source, cycle and foreign-target tests through this variant. No new command or UI key is needed.

## UI and exact texts

Dialog960px/maxviewportminus32;heightmaxviewportminus32;leftoperations280px, righttwo-columnvirtualpreview min400px;rows28px;status/icon/text and exclusioncheckbox per row; footercounts/Cancel/Rename. Invalid/conflicting rows disableRename until excluded/fixed. Loading skeleton, stalepreviewdimmed/notcommittable, error retained; Esc cancels preview or asksCancel runningjob; focusreturns trigger. Usepane/border/text/accent/status tokens; no rawred/green.

| Key | English | Spanish |
|---|---|---|
| rename.title / rename.old / rename.new / rename.action | Bulk rename / Current name / New name / Rename | Cambiar nombres en lote / Nombre actual / Nombre nuevo / Cambiar nombres |
| rename.find / rename.replace / rename.regex / rename.prefix / rename.suffix | Find / Replace with / Regular expression / Prefix / Suffix | Buscar / Reemplazar por / Expresión regular / Prefijo / Sufijo |
| rename.number / rename.start / rename.step / rename.padding / rename.case / rename.template / rename.removeChars | Numbering / Start / Step / Digits / Letter case / Name template / Remove characters | Numeración / Inicio / Incremento / Dígitos / Mayúsculas y minúsculas / Plantilla de nombre / Quitar caracteres |
| rename.includeExtension / rename.exclude / rename.unchanged / rename.conflict / rename.invalid | Include extension / Exclude item / Unchanged / Name conflict / Invalid name | Incluir extensión / Excluir elemento / Sin cambios / Conflicto de nombre / Nombre no válido |
| rename.preset / rename.savePreset / rename.removePreset / rename.previewing | Rename preset / Save rename preset… / Remove rename preset / Updating preview… | Ajuste de nombres / Guardar ajuste de nombres… / Quitar ajuste de nombres / Actualizando vista previa… |
| rename.recovery | Some items could not return to their original names. Review their actual locations before continuing. | Algunos elementos no pudieron recuperar sus nombres originales. Revisa sus ubicaciones actuales antes de continuar. |
| rename.summary | {done} renamed, {excluded} excluded, {failed} failed. | {done} con nombre cambiado, {excluded} excluidos, {failed} con error. |
| batch.title / batch.run / batch.summary | Batch actions / Run on selection / Review per-file results | Acciones en lote / Ejecutar en la selección / Revisar resultados por archivo |
| errors.rename.bad_request / errors.rename.invalid_name / errors.rename.conflict / errors.rename.changed | These rename options are not valid. / This name is not allowed. / Another item already uses this name. / An item changed. Refresh the preview. | Estas opciones de nombres no son válidas. / Este nombre no está permitido. / Otro elemento ya usa este nombre. / Un elemento cambió. Actualiza la vista previa. |
| errors.rename.in_use / errors.rename.too_large / errors.rename.regex / errors.rename.metadata_missing | An item is in use. / This rename exceeds the limit. / This regular expression is not supported. / Required metadata is missing. | Un elemento está en uso. / Este cambio de nombres supera el límite. / Esta expresión regular no es compatible. / Faltan metadatos necesarios. |
| errors.rename.journal_failed / errors.rename.recovery_required / errors.rename.cancelled / errors.rename.failed | Recovery information could not be saved. Nothing was renamed. / Review the recovery locations before retrying. / Renaming was cancelled. / The names could not be changed. | No se pudo guardar la información de recuperación. No se cambió ningún nombre. / Revisa las ubicaciones de recuperación antes de reintentar. / Se canceló el cambio de nombres. / No se pudieron cambiar los nombres. |

Command explorer.bulkRename iconListOrdered labelrename.title helpbulk-rename riskchange shortcutnone (F2 remainsinlineonefile);explorer.batchActions iconLayers labelbatch.title helpbatch-actions. Registerpalette entries through09d, never duplicateCtrlK. Missingoperationoptionlabels are exactkeys rename.lower “Lowercase”/“Minúsculas”,rename.upper “Uppercase”/“Mayúsculas”,rename.titleCase “Title case”/“Iniciales en mayúscula”,rename.utc “UTC dates”/“Fechas UTC”,rename.local “Local dates”/“Fechas locales”.

## Tasks, tests and commits

| Task | Files / ordered algorithm / dependencies | Named tests with exact oracle | Commit |
|---|---|---|---|
| T1 | new bulk-rename crate manifest/lib/types/operations.rs; coordinatorregexdep/license/registration. U1/U2; defineDTOs/caps andpuretransform | crates/bulk-rename/tests/step09e_names_tests.rs: `numbering_skips_excluded_rows` indicesincluded0,2 start1padding3 ->001,002; `unicode_upper_expands_safely` straße->STRASSE; `extension_not_changed_by_default`; `regex_backreference_refused` | `deps: add bounded bulk rename engine [step-09e/T1]` |
| T2 | preview.rs/collisions.rs/native bulk_rename.rs/types/services/bulkRename.ts. U1/U2/U3; compute/page/cancelplan | step09e_preview_tests.rs: A/Bswapready; duplicatefinalnameconflict;NULinvalid;missingdatetakeninvalid;excludedrownotnumbered;stalegenerationignored | `feat(rename): live validated rename plans [step-09e/T2]` |
| T3 | crates/fs-service/src/rename_handles.rs;bulk-rename journal.rs/executor.rs. U2; implementD6-D8 with injectedfilesystemadapter andrealWindowstests | step09e_execute_tests.rs: A↔B contentsremainattachedtosameobjects;case-onlynameworks;newforeignoriginalonrollbackkept;cancelneverdeletesuserintermediate;sourceidentityswapbeforeguardchangesnothing;journalfailurebeforemutation; crash_before_intent/after_intent/after_syscall/before_completion allfindsameobjectonlyatrecordedcandidate | `feat(rename): guarded cyclic rename execution [step-09e/T3]` |
| T4 | rename_history.rs/renameHistory.ts; coordinatorFileActiondispatch/globalUndo;U3/U5/E5 | native `changed_receipt_refused`; `undo_redo_uses_same_objects`; `failed_undo_does_not_confirm_cursor`;partialreportactualpathsequaldisk | `feat(rename): exact rename receipts and history [step-09e/T4]` |
| T5 | rename_presets.rs/renamePresets.ts,BulkRenameDialog.tsx,RenameOperations.tsx,RenamePreview.tsx,styles/bulkRename.css;U1-U3/E1-E4 | bulkRename.test.tsx:150msdebounce;invaliddisabled;excludeconflict;keyboard/alltexts;1001refused;catalogrevisionconflictandno sourcepathpersist | `feat(rename): bulk rename controls and presets [step-09e/T5]` |
| T6 | batch/registry.ts,batch/runBatchAction.ts,BatchActionsDialog.tsx;U4/U6/E6 | batchActions.test.ts:source/snapshottypesunchanged;loss/categoryackrequired;retryneverrepeatscompleted;reportpaginationkeepscounts | `feat(batch): reuse conversion and privacy actions [step-09e/T6]` |
| T7 | fourhelpfilesbelow; coordinatorlocales/pseudo/registries/measurements/shots | helpkeys/routes and oldinline-rename tests retained; coordinator executesrealrace/cancel/journaltests | `docs(help): bulk rename and batch actions [step-09e/T7]` |

## Full help

`bulk-rename.md`, English **Bulk rename**. Intro: “Preview new names for several files before changing anything.” How to use: “Select items and choose **Bulk rename**. Add the operations in the order you want. Review Current name and New name, exclude rows if needed, then choose **Rename**. Review any failures and use Undo to reverse the completed name changes.” Good to know: “Conflicting or invalid names cannot run. Originals are never replaced. If a rollback cannot restore a name, the report shows the actual recovery location; do not remove that item.” See also: “Selecting files” and “Batch actions”. Spanish **Cambiar nombres en lote**. Intro: “Revisa los nombres nuevos de varios archivos antes de cambiar nada.” Cómo usar: “Selecciona elementos y elige **Cambiar nombres en lote**. Agrega las operaciones en el orden deseado. Revisa Nombre actual y Nombre nuevo, excluye filas si hace falta y elige **Cambiar nombres**. Revisa los errores y usa Deshacer para revertir los cambios terminados.” Para tener en cuenta: “No se pueden ejecutar nombres en conflicto o no válidos. Nunca se reemplazan originales. Si no se puede restaurar un nombre, el informe muestra su ubicación real de recuperación; no elimines ese elemento.” Consulta también: «Seleccionar archivos» y «Acciones en lote».

`batch-actions.md`, English **Batch actions**. Intro: “Apply a compatible action to the selected files.” How to use: “Choose **Batch actions**, select a conversion preset or privacy cleaning, and review its options and warnings. Run the action and review the completed, skipped and failed items.” Good to know: “Each action keeps its normal safety choices. Retry acts only on unfinished items. Completed outputs remain if you cancel the rest.” See also: “Batch conversion and presets” and “Removing hidden information”. Spanish **Acciones en lote**. Intro: “Aplica una acción compatible a los archivos seleccionados.” Cómo usar: “Elige **Acciones en lote**, selecciona un ajuste de conversión o la limpieza de privacidad y revisa las opciones y avisos. Ejecuta la acción y revisa los elementos terminados, omitidos y con error.” Para tener en cuenta: “Cada acción conserva sus opciones normales de seguridad. Reintentar afecta solo a elementos sin terminar. Los resultados terminados permanecen si cancelas el resto.” Consulta también: «Conversión por lotes y ajustes preestablecidos» y «Quitar información oculta».

## Reviewer fixtures / speed / screenshots / done

Retain200syntheticphotoswithknownDateTaken andcamera,width;filesa.txt“A”,b.txt“B”,case.txt“case”;reserved/conflictproposals; injectedpermission/cancel/journalwritefailure. Reviewer checks200date-renames/oneUndo/cycles/case-only/liveexclusions/presets/restart/batchreports,unchangedcontenthashes andforeignitemrace. Repeates/dark/pseudo/keyboard200%zoom.

Measure step09e.rename.preview200 Fast<1s; typing/checkbox Instant<100ms; executebatch jobwithCancel/progress; noUIlongtask>50ms. Screenshots99-bulk-rename and100-batch-actions,threevariants. Done: everyexactoperation/receipt/exporttableimplementedwithoutpathoverwrite,allrequiredtestsrunbycoordinator, unfinishedrecoveryjournalsvisible,gate/package/speed/screenshots/reportacceptedbeforepromotion.
