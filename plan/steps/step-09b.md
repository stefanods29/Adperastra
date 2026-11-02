# Step 09b: Tab groups and saved groups

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09b-tab-groups |
| Tag | v0.1.2-step09b |
| Depends on | 09a T1-T7, contract tabs-documents-1/session-2 |
| Written before | 07a was built |
| Interface revision | tab-groups-1; saved-groups-1 |

This guide fixes the implementation decisions. Workers write owned source, tests, styles and help; the coordinator applies shared wiring, executes all checks and commits only verified work. Read `plan/parallel/WORKER-PROMPT.md`; do not compile, install, run tests or generate assets.

## Goal

Name, color, collapse and rearrange groups of tabs; save a group, close it and reopen its validated folder/file positions. A missing file affects its own tab. Saved groups also appear in the navigation pane, plus menu and command palette.

## Do not do

No cross-tab content or external file drop handling (09c), split implementation (09i), user account sync, AI, detached windows or automatic file moves. Group operations change app state only. Never save passwords, file grants, unsaved content or decrypted names from locked folders.

## Read first

Full09a; v1 `step-09a.md` group/saved-group paragraphs; `src/services/tabs.ts`, `src/layout/TabStrip.tsx`, `src/services/undo.ts`, `src/views/useUnsavedChanges.tsx`, `src/handlers/openPipeline.ts`; native session/atomic-write code; add-command/help/settings recipes. The baseline definition paths above are fixed; workers never choose a substitute.

## Decisions

- D1. At most32 live groups; each has a UUID, a nonempty trimmed name of1-60 Unicode scalar values, one fixed color ID, collapsed flag and ordered member IDs. No nested groups. Eligible members: unpinned folder/file tabs, and split tabs after09i. Permanent Explorer and Help/Settings/Components remain outside groups. Pinning a grouped tab removes membership first; empty groups disappear.
- D2. Members occupy one contiguous segment in `TabsState.tabs`. Creating a group from scattered tabs gathers them in existing display order at the earliest selected eligible position. Adding a tab appends it after the last member. Removing a member places it immediately after that group; remaining members keep order. Moving a group moves its whole segment. Group metadata, tab order and active ID update in one reducer transaction.
- D3. Collapsed groups draw only a label and member count. An active member remains visible as one active tab after the label; the other members are hidden visually, not closed/unmounted merely by collapse. Activating a hidden member expands its group. Keyboard tab navigation uses actual tabs, not group labels as extra tab positions. Group labels have separate roving button focus and expand state.
- D4. Colors are `purple`, `blue`, `green`, `teal`, `orange`, `red`, mapped respectively to existing accent group/explorer/excel/image/powerpoint/pdf tokens. No raw colors. Use primary text on pane surface, a3px colored group underline and8px dot; color is never the sole label. Group label height32px within existing40px tab strip; inline name max160px with ellipsis and full accessible label.
- D5. Close group first asks once per dirty underlying document losing its last view, using09a shared-document close coordination. Cancellation leaves every tab/group unchanged. Save-and-close saves descriptors successfully before closing; a storage failure keeps the group open. Discarding unsaved edits is an explicit dirty-dialog decision; reopening a group does not recover discarded content.
- D6. Saved catalog is `<data>/saved-tab-groups.json`, schema1, at most100 groups/4MiB. A saved group has at most200 descriptors but reopening must respect total200 live tabs; check capacity before any open. App-state writes are atomic. Update is explicit, never silently triggered by changes to a reopened live group.
- D7. Export is a new `.adpgroups` file with the same schema and at most100 selected groups; write through owned no-replace output. Import parses at most4MiB in a bounded JSON helper, rejects unknown newer schemas/prototype keys and reports invalid descriptors. One invalid group rejects the import without altering the catalog. Assign fresh UUIDs on import; duplicate names are allowed and distinguished by modified date. No automatic opening or external app launch during import.
- D8. Reopening makes fresh tab/group IDs and follows normal09a source/handler/protected-view authorization. Open the saved active member first, at most2 source opens concurrently; defer inactive views. Missing files show09a Locate placeholders. Virtual entries retain only opaque container reference/entry ID, no plaintext title/view; require later unlock. One unsupported handler does not abort the other members.
- D9. Undo group creation/rename/color/collapse/membership/close through09a `TabHistory` using bounded session descriptors, never closures or live file tokens. Undo catalog save/remove/update stores only the prior/next bounded catalog in `SavedGroupHistory`, using the global history dispatcher extension below. Unknown or stale history IDs fail without moving the global cursor. Reopen uses the normal pipeline.
- D10. No settings schema bump: incoming/outgoing20. Session schema remains2 with additive default-empty `groups` and optional `group_id` fields. Limits apply in native validation as well as UI. Existing session readers ignoring new optional fields remain compatible.

## Uses from other steps

| ID | Producer/task and canonical symbol | Exact consumption and lifetime |
|---|---|---|
| U1 | 09a T1/T3; `src/services/tabs.ts`: TabsState, TabState, openFolderTab, activateTab | Use existing tab IDs/order/active/history; additions below are optional on input and normalized on output. Never duplicate permanent Explorer. Revision tabs-documents-1 |
| U2 | 09a T5; `src/services/viewState.ts`: registerViewStateCodec; SessionData in tabs.ts | Saved descriptors use the same versioned64KiB/view, depth8,4MiB/session validation and secret exclusions. Revision session-2 |
| U3 | 09a T2/T6; DocumentRegistry and last-view close coordinator | acquire/release reference counts per view; dirty document confirmation occurs once before atomic group close. Do not discard a document still viewed elsewhere |
| U4 | 04a `planOpen(path,registry,openWith)` normal open decision;09a missing placeholders | Restore through this pipeline, not direct handler construction. Canonical path is src/handlers/openPipeline.ts |
| U5 | 03b `src/services/undo.ts`: UndoStack.push(UndoEntryInput), peek/confirm Undo/Redo | Extend FileAction only with the exact variant E7. Executor confirms history cursor only after successful restore/write |
| U6 | 09a TabHistory API in `src/services/tabHistory.ts` | record(before SessionData,after SessionData,labelKey string,labelArgs optional Record<string,string|number>)->UndoEntryInput; apply(id string,reverse boolean)->Promise<void>; releaseUnreferenced(ids readonly string[])->void. This is09a E10, tabs-documents-1 |
| U7 | fs-service atomic_write for app state; owned_io for user export; existing Dialog/Menu/Tooltip | Atomic catalog changes, no-replace export, existing focus trapping/translated labels; no unowned temporary-file cleanup |

## Data shapes

Canonical UI types `src/services/tabGroups.ts`; persistence DTOs `src/services/savedGroups.ts` mirrored in `src-tauri/src/saved_group_types.rs`. All serialized fields use snake_case. Existing camelCase TabsState fields stay unchanged.

| Type/field | Exact shape/default/validation |
|---|---|
| GroupColor | purple/blue/green/teal/orange/red, defaultpurple |
| TabGroup | id UUID string; name string1-60; color GroupColor; collapsed booleanfalse; tab_ids string[]1-200 unique live eligible IDs |
| TabsState.groups | optional readonly TabGroup[] on legacy input; normalized array max32, defaultempty |
| TabState.group_id | optional UUID; reducer maintains consistency with one group's tab_ids; ungrouped omitted |
| SavedTabDescriptor |09a SessionData.tabs element without id, group_id or runtime document_id; add optional kind split only when09i extends the canonical descriptor. Use original validated source/folder/handler/view/view_version/pinned fields; pinned mustfalse; no arbitrary spread of TabState |
| SavedTabGroup | id UUID; name1-60; color GroupColor; tabs SavedTabDescriptor[]1-200; active_index integer0..tabs.length-1; created_unix/modified_unix safe nonnegative seconds; version integer1 |
| SavedGroupCatalog | schema_version integer1; groups SavedTabGroup[]max100; revision safe integer starting1 and incremented once per successful write |
| GroupPatch | optional name/color/collapsed fields only; at least1 recognized field; unknown fields refused |
| SavedGroupWrite | expected_revision safe integer; group SavedTabGroup; native validates all descriptors and preserves created_unix for existing ID |
| GroupRestoreReport | group_id newUUID; tab_ids string[]; missing_count integer; unsupported_count integer; no file bytes or tokens |
| SavedGroupHistoryRecord | id UUID; before/after SavedGroupCatalog; session-only registry, total16MiB/100records; records required by global Undo retained, older entries evicted together with global references |

## Exports for later steps

| ID | Canonical file/symbol | Parameters -> result; errors/consumers |
|---|---|---|
| E1 | tabGroups.ts createTabGroup | (state TabsState,tabIds readonly string[],name string,color GroupColor)->TabsState; pure, invalid input throws stable tabs.invalid_group.09c/09d/10e |
| E2 | same patchTabGroup/addTabsToGroup/removeTabsFromGroup/ungroupTabGroup | patch(state,id,patch GroupPatch); add(state,id,tabIds); remove(state,tabIds); ungroup(state,id), all ->TabsState, pure atomic, reject unknown IDs. Ungroup retains member order/content |
| E3 | same moveTabGroup | (state TabsState,id string,targetIndex integer)->TabsState; destination is index in tab array after removing group segment; cannot enter pinned segment/another group |
| E4 | savedGroups.ts listSavedGroups/writeSavedGroup/removeSavedGroup | native saved_groups_list()->SavedGroupCatalog; saved_group_write(request SavedGroupWrite)->SavedGroupCatalog; saved_group_remove(id UUID,expected_revision number)->SavedGroupCatalog; TS same semantic args ->Promise<catalog>. Conflict returns groups.changed; no last-writer overwrite |
| E5 | same exportSavedGroups/importSavedGroups | exportSavedGroups(ids readonly string[],destPath string)->Promise<{path:string,bytes:number}>; importSavedGroups(path string,expectedRevision number)->Promise<SavedGroupCatalog>. Commands saved_groups_export(ids,dest_path),saved_groups_import(path,expected_revision); no silent merge/replace |
| E6 | `src/tabs/restoreSavedGroup.ts`: restoreSavedGroup | (saved SavedTabGroup,host GroupRestoreHost)->Promise<GroupRestoreReport>. Host exact methods getState()->TabsState; reserve(count number)->Promise<string> reservationID; open(descriptor SavedTabDescriptor,background boolean,reservationId string)->Promise<string>; commit(group TabGroup,activeId string,reservationId string)->Promise<void>; rollback(reservationId string)->Promise<void>. Host belongs to coordinator, no worker-private App variables.09d/09g/10e |
| E7 | savedGroups.ts SavedGroupHistory; undo.ts FileAction | record(before,after)->stringUUID; apply(id string,reverse boolean)->Promise<void>; releaseUnreferenced(ids readonly string[])->void. New FileAction type savedGroups with id string/reverse boolean. Native catalog write still checks current revision; stale application fails groups.changed |
| E8 | `src/tabs/TabGroupLabel.tsx`: TabGroupLabel | props group TabGroup,memberCount number,active boolean,onToggle()->void,onMenu(anchor DOMRect)->void; no native calls. SavedGroupsPanel props catalog/loading/errorCode?,onOpen(id)->Promise<void>,onRename(id,name)->Promise<void>,onRemove(id)->Promise<void>,onImport()->Promise<void>,onExport(ids)->Promise<void>,onOpenHelp(slug)->void |

Native commands are main-window-only, validate all paths/IDs/lengths before work, return Result<DTO,String>; errors groups.invalid,groups.limit,groups.changed,groups.io,groups.unsupported_version,groups.cancelled. No jobs needed for bounded catalog reads; import/export use shared jobs if measured over1s and always cancellable before publication. File export is no-replace; unknown fields rejected rather than persisted.

## Texts, commands and layout

Use Dialog width400px for naming/color,520px for saved catalog, maxviewport minus32px. Rows36px, color buttons28x28 with accessible translated color name/pressed state. Group popup uses existing Menu roles; Esc closes and restores label focus. Name field rejects empty/overlong without closing. Saved list virtualizes at20rows, shows name/count/modified; loading skeleton, empty text and retryable error keep controls reachable.

| Key | English | Spanish |
|---|---|---|
| groups.new / groups.add / groups.remove | New group / Add tab to group / Remove from group | Nuevo grupo / Agregar pestaña a un grupo / Quitar del grupo |
| groups.rename / groups.color / groups.collapse / groups.expand | Rename group / Change color / Collapse group / Expand group | Cambiar nombre del grupo / Cambiar color / Contraer grupo / Expandir grupo |
| groups.ungroup / groups.close / groups.save / groups.saveClose | Ungroup / Close group / Save group / Save and close | Desagrupar / Cerrar grupo / Guardar grupo / Guardar y cerrar |
| groups.saved / groups.update / groups.export / groups.import | Saved groups / Update saved group / Export groups… / Import groups… | Grupos guardados / Actualizar grupo guardado / Exportar grupos… / Importar grupos… |
| groups.name / groups.empty / groups.open | Group name / No saved groups yet. / Open group | Nombre del grupo / Todavía no hay grupos guardados. / Abrir grupo |
| groups.count | {count, plural, one {# tab} other {# tabs}} | {count, plural, one {# pestaña} other {# pestañas}} |
| groups.confirmRemove | Remove “{name}” from saved groups? Its files will stay where they are. | ¿Quitar «{name}» de los grupos guardados? Sus archivos permanecerán donde están. |
| groups.purple / groups.blue / groups.green / groups.teal / groups.orange / groups.red | Purple / Blue / Green / Teal / Orange / Red | Morado / Azul / Verde / Verde azulado / Naranja / Rojo |
| toast.groupChanged / toast.groupSaved | Tab group updated. / Group saved. | Se actualizó el grupo de pestañas. / Se guardó el grupo. |
| errors.groups.invalid / errors.groups.limit / errors.groups.changed | This tab group is not valid. / The group limit has been reached. / Saved groups changed. Reload them and try again. | Este grupo de pestañas no es válido. / Se alcanzó el límite de grupos. / Los grupos guardados cambiaron. Vuelve a cargarlos e inténtalo de nuevo. |
| errors.groups.io / errors.groups.unsupported_version / errors.groups.cancelled | The tab groups could not be saved or opened. / This group file needs a newer app version. / The group action was cancelled. | No se pudieron guardar o abrir los grupos. / Este archivo de grupos necesita una versión más reciente. / Se canceló la acción del grupo. |

Each slash-separated entry is a separate full key/text. Command IDs tab.groupNew (FolderPlus),tab.groupRemove (FolderMinus),tab.groupSave (Save),app.savedGroups (PanelsTopLeft); label keys groups.new/remove/save/saved, risk change except app.savedGroups read-only; no default shortcuts; help tab-groups/saved-tab-groups. Existing Ctrl+Tab remains09a. Do not use Ctrl+Shift+S, reserved for Save as.

## Tasks

### T1: Canonical state and validation

Files: create tabGroups.ts, tabGroupValidation.ts, saved_group_types.rs; coordinator extends tabs/session types and root serde defaults. Dependencies U1/U2. Define all tables, reject duplicate/multiple membership, normalize legacy empty groups. Preserve optional future fields only through known descriptor codecs.

Tests `src/__tests__/tabGroups.test.ts`: `gathers_scattered_tabs_in_display_order`, input permanent,A,X,B grouping A/B ->permanent,A,B,X; `rejects_pinned_and_permanent_members` leaves input unchanged; `drops_empty_group`; `legacy_session_defaults_to_no_groups`; native `refuses_duplicate_membership` and `refuses_newer_catalog` expect groups.invalid/unsupported_version. Commit `feat(tabs): validated tab group state [step-09b/T1]`.

### T2: Group reducers and undo

Files: tabGroupActions.ts, tabGroupHistory.ts; coordinator reducer/Undo dispatch wiring only. Dependencies U1/U3/U5/U6. Implement D2/D3, atomic group transactions, dirty-safe close preparation, bounded history. Never call save/discard until all required dirty decisions are collected; cancellation has no structural effects.

Tests tabGroupActions.test.ts: `remove_member_places_it_after_group`, A/B/Cgroup removeB ->A,C,B; `active_hidden_member_expands`; `cancel_close_preserves_all_tabs`; `shared_document_prompted_once`; `undo_reopens_through_host_without_old_tokens`; history failure does not confirm cursor. Commit `feat(tabs): atomic group actions and history [step-09b/T2]`.

### T3: Saved catalog

Files: savedGroups.ts,saved_group_store.rs,saved_group_validation.rs; coordinator native command/state wiring. Dependencies U2/U7. Implement E4, compare revision under cross-process app-state lock, bounded read/atomic write, allowlisted descriptors. No lock held across source parsing/opening.

Tests native `revision_conflict_keeps_original_bytes`, expected3/current4 ->groups.changed; `one_hundred_and_first_group_refused`; `virtual_names_and_tokens_not_saved`; `failed_write_keeps_old_catalog`. UI savedGroups.test.ts mirrors revision args exactly. Commit `feat(tabs): atomic saved group catalog [step-09b/T3]`.

### T4: Open, import and export

Files: restoreSavedGroup.ts, saved_group_transfer.rs, savedGroupTransfer.ts. Dependencies U2/U3/U4/U7. Implement E5/E6 and capacity reservation, rollback only newly created runtime state on host failure, missing placeholder success. Export never overwrites; import never executes/open paths.

Tests `src/__tests__/restoreSavedGroup.test.ts`: `visible_first_two_open_limit`; `missing_member_does_not_abort_others`; `capacity_failure_opens_nothing`; `unknown_provider_placeholder`; native `import_assigns_fresh_ids`, `four_mib_plus_one_rejected`, `export_collision_keeps_both_files`. Commit `feat(tabs): restore and transfer saved groups [step-09b/T4]`.

### T5: Group and catalog controls

Files: TabGroupLabel.tsx, TabGroupMenu.tsx, SavedGroupsPanel.tsx, styles/tabGroups.css. Coordinator TabStrip/nav/plus-menu routes. Dependencies U1/U3/E1-E8. Implement specified roles/labels/menu/widths/keyboard; close catalog only after awaited success. Group drag uses tab IDs, not external content payloads.

Tests tabGroupsUi.test.tsx: name/color/collapse keyboard paths, Enter opens selected saved group, Esc restores trigger, readonly/error/empty states,200%zoom and Spanish label fixtures. Check no two TabStrip owners and no lost view identity on group movement. Commit `feat(tabs): accessible group and saved group controls [step-09b/T5]`.

### T6: Localization, help and reviewer integration

Files: help/en/tab-groups.md,help/es/tab-groups.md,help/en/saved-tab-groups.md,help/es/saved-tab-groups.md; coordinator locales/commands/measurements/screenshots/registry records. Add all keys above, no worker-generated pseudo file. Test group help links and command uniqueness in dedicated step09b test. Commit `docs(help): tab groups and saved groups [step-09b/T6]`.

## Full help

`tab-groups.md`, English title **Tab groups**. Intro: “Keep related tabs together without moving their files.” How to use: “Right-click a tab and choose **Add tab to group > New group**. Give the group a name and color. Use its label to collapse or expand it. Right-click the label to rename, change color, ungroup or close the group.” Good to know: “Ungroup keeps the tabs open. Closing a group checks for unsaved changes. Pinned tabs and the permanent Explorer tab stay outside groups.” See also: “Saved groups” and “Working with tabs”.

Spanish title **Grupos de pestañas**. Intro: “Mantén juntas las pestañas relacionadas sin mover sus archivos.” Cómo usar: “Haz clic derecho en una pestaña y elige **Agregar pestaña a un grupo > Nuevo grupo**. Dale un nombre y un color. Usa su etiqueta para contraerlo o expandirlo. Haz clic derecho en la etiqueta para cambiar el nombre o color, desagrupar o cerrar el grupo.” Para tener en cuenta: “Desagrupar mantiene abiertas las pestañas. Cerrar un grupo comprueba los cambios sin guardar. Las pestañas ancladas y la pestaña permanente del Explorador quedan fuera de los grupos.” Consulta también: «Grupos guardados» y «Trabajar con pestañas».

`saved-tab-groups.md`, English title **Saved groups**. Intro: “Save a set of tabs and reopen its supported positions later.” How to use: “Right-click a group label and choose **Save group**. Open **Saved groups** in the navigation pane or plus menu to reopen it. Use **Update saved group** to replace its saved tab list. Use **Export groups…** and **Import groups…** to transfer a small group file.” Good to know: “Saved groups contain locations and view positions, not unsaved edits or passwords. Missing files have a Locate action. Locked folders must be unlocked again. Removing a saved group does not delete its files.” See also: “Tab groups” and “Sessions”.

Spanish title **Grupos guardados**. Intro: “Guarda un conjunto de pestañas y vuelve a abrir sus posiciones compatibles.” Cómo usar: “Haz clic derecho en la etiqueta de un grupo y elige **Guardar grupo**. Abre **Grupos guardados** en el panel de navegación o el menú del signo más. Usa **Actualizar grupo guardado** para reemplazar la lista guardada. Usa **Exportar grupos…** e **Importar grupos…** para transferir un archivo pequeño de grupos.” Para tener en cuenta: “Los grupos guardan ubicaciones y posiciones, no cambios sin guardar ni contraseñas. Los archivos que faltan tienen la opción Buscar archivo. Las carpetas bloqueadas deben desbloquearse de nuevo. Quitar un grupo guardado no elimina sus archivos.” Consulta también: «Grupos de pestañas» y «Sesiones».

## Check by hand

| Fixture | Exact content |
|---|---|
| retained step09b/A/one.txt; B/two.txt | UTF8 “one” and “two”, no trailing newline |
| missing.txt | UTF8 “missing”; coordinator moves it to missing-moved.txt after saving group |
| valid/newer/oversize .adpgroups | Fields from catalog table with schema1/schema2/4MiB+1; use only synthetic fixture paths |

Coordinator: group A/file/B, reorder/collapse/activate/ungroup/Undo; save and restart; move missing fixture and restore other members; import/export/collision; dirty shared-view close/cancel; confirm source hashes unchanged. Repeat keyboard-only, Spanish dark and pseudo at200%zoom.

## Speed, screenshots and done

Measurements step09b.group.toggle and step09b.group.menu Instant<100ms; step09b.saved.open first visible member Fast<1s or bounded loading feedback, remaining opens jobs as needed. Screenshot93-tab-groups and94-saved-groups in en/light,es/dark,pseudo. Coordinator uses scripts/measure-ui.mjs and existing retained-fixture runner, no legacy permanent cleanup.

- [ ] All group/catalog operations and revision conflicts match the exact tables; consumers resolve E1-E8 without private App state.
- [ ] Session and saved descriptors contain no secrets/decrypted content; dirty close is atomic and undo does not promise discarded edits.
- [ ] Coordinator executes gate/package/accessibility/localization/history/safety checks and records measured evidence before promotion. No worker claims test execution.
