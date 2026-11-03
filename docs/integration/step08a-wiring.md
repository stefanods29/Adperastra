# Step08a staged implementation and exact wiring

Source: `handoff/integration-08a/files/<repository-relative-path>`. Original handoff/step-08a remains unchanged. No compilation/build/tests/install/app run performed by this worker. Central verification must run before acceptance.

## Apply shared changes

Use original handoff/step-08a/proposals for complete dependency/settings/locale/IPC/UI wiring, with these corrections:

1. All existing managed cache/file/snapshot producers use their actual Arc-managed types. `ExportSnapshots` is managed as `Arc<ExportSnapshots>` and owns its SnapshotAuthorityRegistry; keep one registry and one shared cache. Register NativePdfSnapshotResolver with the actual PdfSnapshotResolvers producer.
2. Add `PinnedSource::from_owned_file(File)->OwnedIoResult<PinnedSource>` from `handoff/integration-08a/pinned-source-addition.rs` to canonical fs-service owned_io/source.rs. It wraps a duplicated handle to an exclusively app-owned immutable snapshot, never reopens or publishes/deletes its path. The snapshot's `SnapshotRetentionHandle` keeps original OwnedOutput and directory alive until all clones drop. New invariant regression retains exact foreign same-name bytes through cleanup.
3. Add one `convert` workspace crate with pinned approved image/resvg/little_exif engines from manifest/proposal; native direct sha2/fs2. Add module roots convert_helper, convert_jobs, convert_publish, convert_reports, export_snapshots, export_snapshot_types, export_upload, snapshot_authorities and pdf_export_snapshot_resolver. Included fragments are owned by their roots; do not declare duplicate root modules.
4. Dispatch --convert-helper before Tauri startup. Commands and isolation names come from convert_commands.rs/export_snapshot_commands.rs and authority command implementations. Protocol route export_upload is a bounded raw POST under adpfile; no snapshot bytes in invoke JSON.
5. Manage ConvertGate::default(), ConversionReports::default() and Arc<ExportSnapshots> constructed from canonical data folder. Schema16 adds conversion settings exactly as guide; preserve schema15 values and update measurement settings.
6. UI uses ConversionProvider with actual trackJob/currentFolder/notifications/showResult and existing UndoStack. Add optional HandlerViewProps.registerExport and native-authorized immutable text/image capture. All commands open the same QuickConvertDialog. No fake browser-only conversion success fallback.
7. New locale key `convert.undoUnavailable`: English “Conversion Undo is unavailable until exact file recovery is supported.” Spanish “No se puede deshacer la conversión hasta que se admita la recuperación exacta de archivos.” Keep successful completion/Explorer refresh even with Undo unavailable. Do not advertise Undo in UI/help until09f exact-object receipts are wired.

## Repairs in staged code

- Snapshot finalization retains OwnedOutput and duplicated same-object read backing; no publish/reopen/path deletion. Resolved reads use bounded positioned GrantedBacking reads. Snapshot policies derive from native authority and sensitive bytes stay memory-only.
- ConvertGate cancellation interrupts waiting admission; publish operations serialize across volumes conservatively. Sink limits chunks/output sizes and uses owned staging/no-replace publication.
- Preview source reads use open_background with same-handle no-recall protection; full source stamp rechecked after pinning. Foreground user conversions retain normal explicit-open behavior.
- Parent validates mode-specific frames: preview mode cannot begin/write/finish/abort output files. PNG is delivered in <=1MiB chunks, accumulated under4MiB, dimensions checked against metadata and512edge. Preview timeout is5seconds. Conversion cumulative output remains bounded. Invalid abort/index/mode fails closed.
- Corrected actual HelperSource/input_index mismatch. Child helper frames now <=1MiB; final/progress/metadata remain <=64KiB. Original frame10 is an additive preview-PNG chunk type; no binary JSON.
- Late preview completion is observed before cancel awaits; stale lease is released. SVG DOCTYPE check covers whole bounded document, not only a header prefix.
- Conversion history no longer installs unsafe path-only recycle/restore actions. T7 guide explicitly permits unavailable-with-reason until09f receipts; tests now assert cancelled/completed outputs remain reported but cannot manufacture destructive Undo/Redo. Existing shared cursor failure assertion remains tested independently.

## Tests to run centrally

All staged crate/native/UI tests, plus new transport mode rejection and updated history safety assertions. Full gate, real helper cancellation/timeout, synthetic metadata fidelity, UI unsaved snapshot capture, byte hashes, release/screenshots/speed are pending. No worker claims that static review proves execution or final acceptance.

##08b/08c coordination

SnapshotLease is {snapshot:ExportSnapshot,backing:Arc<GrantedBacking>,retention:Arc<dyn SnapshotRetention>}; resolve(snapshot_id,document_id,revision) unchanged.08b native PDF/document adapters need dispatch before08a builtin image worker because pure ConvertSource cannot carry snapshot authority identity.08b owns an additive native adapter hook and exact wiring; coordinate its native registry before advertising non-image converters.08c consumes canonical DTO/reader types unchanged.

Original-image preview uses canonical previewGrant(path,true)/previewRevoke, retaining07b background no-recall/protection guards instead of foreground fileGrant. QuickConvert tests mock the canonical previewservice; snapshot inputs remain ungranted fromdisk.

## Central integration verification

Applied to production source. Full gate after idle-cleanup fix passed875Rust/808UI tests. Actual debug conversion helper passed5synthetic checks. See docs/step-reports/step-08a.md for exact scope and remaining packaged acceptance. Worker-only no-run notes above describe the original staging phase.
