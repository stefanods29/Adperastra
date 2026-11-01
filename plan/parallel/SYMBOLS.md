# Cross-step names: verified baseline and mandatory guide tables

Baseline checked: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. This file records existing public names and the format every full step guide must use. It does not invent missing future APIs or make the assignment briefs ready for implementation.

## Rules for every guide

1. Include **Uses from other steps**, with one row per imported function/type/constant and every cross-step field, variant, callback, command ID, translation key or persistent setting the task uses. Merely saying "depends on 07a" is insufficient.
2. Include **Exports for later steps**, with the exact canonical definitions that future guides must consume. The coordinator writes these producer rows first when planning ahead.
3. Give each row a stable ID local to the guide. Every task names the rows it consumes and produces. A consumer points to the producing step and row ID; the coordinator checks the two rows match.
4. Record source file, public name, exact input/field types, output/error shape, validation/default/units, ownership/cancellation/lifetime and the verified baseline SHA or frozen contract revision. For IPC, list the Rust parameter name, TypeScript argument key and nested serialized field names separately.
5. Local variables private to another function/module are not an interface. Never tell a worker to access them. Expose only an explicitly specified additive public contract if needed.
6. A not-yet-built producer is allowed only when its complete export row is frozen. Label it **specified, not implemented**, name its provider worker and expected canonical file, and keep its interface identical in all consumers. "TBD", "something like", an approximate spelling or a contract section number alone is not enough to dispatch dependent code.
7. Workers do not rename an imported symbol, duplicate a type, add a compatibility shim or edit another step to make their guess work. They report a mismatch; the coordinator fixes the guide/contract and informs all affected consumers.
8. Public-field additions are additive/defaulted/optional where required by the current contracts. New fields do not change an existing field's meaning. Keep Rust/TypeScript wire fields in snake_case.
9. Before accepting each guide, trace every dependency to current source or the frozen producer row and trace every new export to its implementation task. Before accepting returned code, compare its imports/calls/field access against those tables. Compilers and tests are a later reviewer check, not a substitute for this review.

## Verified baseline examples

These examples show actual names and common traps. A consuming full guide must still list the precise subset and complete semantics it needs; this is not an exhaustive source inventory.

| ID | Producing step | Canonical file and exact public name | Inputs/fields and output | Important requirement |
|---|---|---|---|---|
| B01 | 06d | `src/services/jobs.ts`: `newRequestId` | `prefix`: string; returns string | Prefix is 1-12 lowercase ASCII letters. Error is `jobs.bad_prefix`. Do not invent a second ID generator. |
| B02 | 06d | `src/services/jobs.ts`: `runJob<T>` | `prefix`: string; `start`: callback taking `requestId` string and returning Promise of void; optional `onProgress`: callback taking `OpProgress`; returns Promise of `JobHandle<T>` | It is asynchronous. Await the handle before accessing `completion` or `cancel`. It polls existing `job_poll`/`job_cancel`; no Channel. |
| B03 | 06d | `src/services/jobs.ts`: `JobHandle<T>` | `id`: string; `cancel`: callback returning Promise of void; `completion`: Promise of T | It has no `result` property. Do not confuse a job handle with the internal poll response. |
| B04 | 06d | `src-tauri/src/helper.rs`: `HelperProcess::spawn`, `DriveTimings` | Spawn takes helper flag string reference and memory limit usize; returns Result of HelperProcess or String. Timings fields: `tick`, `idle`, `grace`, all Duration | Current default values are 100 ms, 30 s and 5 s. A future guide may specify task-specific limits but cannot silently change existing consumers. |
| B05 | 04a/06a | `src/handlers/types.ts`: `Handler`, `HandlerViewProps`, `SaveHandle` | Handler has `id`, `version`, format/capability fields; `editable`/`supportsReplace` are optional. SaveHandle `save` returns Promise of boolean; `discard` returns void | Register through the existing contract. `save` success is a boolean, not a path or saved-file record. |
| B06 | 06a | `src/handlers/types.ts`: `HandlerViewProps.registerSave`, `onDirtyChange`, `onPathChange` | Optional callbacks: SaveHandle-or-null to void; boolean to void; string path to void, respectively | These callbacks can be absent. Cleanup unregisters the save handle; a preview must not become an independently editable document. |
| B07 | 06a | `src/views/useUnsavedChanges.tsx`: `useUnsavedChanges`, `UnsavedChanges.confirmClose` | Hook takes readonly TabState array; returns UnsavedChanges. `confirmClose` takes readonly string-ID array and returns Promise of boolean | Await close approval. The result is not synchronous and is not an array of approved tabs. |
| B08 | 06b | `src-tauri/src/versions.rs`: `before_modify`, `ModifyReason` | AppHandle reference, Path reference, ModifyReason; returns Result of unit or String. Existing variants: `Save`, `SaveAs`, `Restore` | The old two-argument hook is obsolete. `Convert` and `Clean` are not existing variants: the coordinator must specify/add them before consumers use them. |
| B09 | 06e and later repairs | `crates/fs-service/src/owned_io/mod.rs`: `PinnedDirectory`, `PinnedSource`, `SourceIdentity`, `OwnedOutput`, `ClosedOutput`, `OwnedIoError` | Public re-exports from the owned-I/O module; output methods live in `output.rs` | The canonical types are shared, not copied. Use the exact method signatures from current source in each consuming guide. Never resurrect predictable staging names. |
| B10 | 06a and KI-068 repair | `crates/fs-service/src/save.rs`: `replace_contents` | target Path reference; bytes byte-slice reference; expect Option of SaveExpect; returns Result of SavedInfo or SaveError | SaveExpect fields `modified_unix`, `size` are u64; SavedInfo fields `size`, `modified_unix` are u64. Existing content-save race KI-069 remains a separate limitation. |
| B11 | 06a and KI-068 repair | `crates/fs-service/src/save.rs`: `write_new_file` | target Path reference and bytes byte-slice reference; returns Result of SavedInfo or SaveError | Creates a new file only. Existing targets are refused. Old ledger names `recycle_target`, `partial_path` and SaveError variant `RecycleFailed` are not current public APIs. |
| B12 | 02 | `src/services/explorer.ts`: `displayPath`, `samePath` | Display takes a path string and returns string; comparison takes two path strings and returns boolean | Actual file is `explorer.ts`, not a guessed `paths.ts`. Folder trailing-separator comparison has additional semantics documented in the ledger; use the correct folder-key helper where required. |
| B13 | 06c | `src-tauri/src/main.rs`: `CURRENT_SCHEMA`; `src/services/settings.ts`: `SETTINGS_SCHEMA_VERSION` | Both constants are 11 at this baseline | The next unallocated settings schema is 12. The coordinator allocates it, not each worker independently. |
| B14 | 04a | `src/services/tabs.ts`: `TabsState`, `TabState`, `SessionData` | TabsState fields `tabs`, `activeId`, `history`. SessionData has `tabs`, `active_tab`, `saved_unix` | Frontend state and serialized state have different names. Baseline SessionData does not yet serialize every future group/split/view field. |

These rows are source-verified examples rather than executable snippets. Any changed base revision requires rechecking the affected rows. Historical guide text is not evidence that a removed function still exists.

## Future producer/consumer records

For each of I1-I9 in INTERFACES.md, the coordinator must supply exact producer export rows and mirror them into every consuming guide. For example, 07d's PDF page/text interface must be fixed before 07e OCR, 08b conversion, 14a editing and 11a indexing refer to it. 20a's engine-neutral editing interface must be fixed before 20b, 21a and 22a use it, while engine-specific behavior remains contingent on the real checkpoint.

The final review must find **zero unresolved cross-step names** in a dispatched guide. That is a checkable condition; a general promise that agents will be careful is not.
