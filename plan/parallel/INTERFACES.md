# Interface agreements for simultaneous code writing

This is the dependency and ownership register, not a claim that future APIs exist. Existing names below were checked against the baseline; future names/fields must be fixed in the accepted full guides and recorded here by the coordinator before consumers use them.

## Freeze procedure

1. The coordinator reads current code and writes the provider contract into the full producing-step guide and canonical interface register. Include exact existing symbols extended and new canonical definition paths; full parameter/return/field tables; defaults/validation; errors; limits; ownership; cancellation; examples as data tables; compatibility and written tests. No API invented from memory. Coding workers do not design these contracts.
2. The coordinator checks every consuming-step guide's exact dependency rows against that provider's export rows. Workers confirm their code uses those imports/calls and report concrete mismatches. The coordinator corrects the guides; silence is not agreement.
3. The coordinator records an immutable contract revision, producer step, consuming steps and exact changes. “Proposed” becomes “frozen” only when every affected consumer is accounted for and no field/limit/lifetime is left open.
4. Shared declarations and extension points are applied by the coordinator to a reviewed common base. All workers use that revision. A contract file has one canonical owner; workers import it, never copy its types into private feature files.
5. Workers can implement different bodies against those types concurrently. A module whose provider is unfinished is not registered in the packaged app until the reviewer verifies that dependency. Test doubles stay in tests and are explicitly not production support.
6. Any later contract change lists impacted providers, consumers, migrations, tests and shared wiring, obtains their review, increments the contract revision and rebases affected work. No unilateral field-meaning change.

Freeze status at packet creation: **I1-I9 all require coordinator specification/review.** This packet is not yet a set of complete per-step coding guides. Coding workers start a step only after its guide and dependency/export tables are complete and frozen. They never expand a missing guide or guess unfinished interfaces.

## I1 — Cached results and common background policy

**Provider:** A, 07a. **Consumers:** B/C/G/H/I/J/K; E/F for thumbnail-bearing panels. **Current anchors:** contract 15 (`crates/cache-store`, not built); existing shared Jobs and HelperProcess; settings schema 11.

Freeze these independently where possible:

- Cache request identity: normalized path, source identity/revision, size, modified timestamp and handler/engine/config version. Include explicit treatment of path reuse, hard links, growing files and edits during decoding.
- Result descriptor: finite kind/media type, dimensions or text revision where applicable, blob reference/grant and expiry. No raw arbitrary path or huge base64/JSON payload.
- Read/write/lease lifecycle: cache miss, single-flight request, pin/release, last consumer cancellation, publication, source-changed rejection, eviction, startup orphan handling and schema migration.
- Disk/accounting: index versus blob/pending/open physical bytes; per-category cap and clear behavior; no deleting a live/pinned or foreign file; coordination across app processes/profiles.
- Background task kind registration: thumbnails now; metadata/OCR/index/scans/sizes/version cleanup later. One policy decides on/off, idle, AC and global pause; 12a adds fuller rules without replacing that API.
- Execution: bounded worker count/queue, priority, cancellation, helper CPU/memory/time limits and failure isolation. Foreground work has a documented path that does not silently bypass cloud/privacy authorization.
- Sensitive-source classification: unlocked container content must never enter a normal persistent cache/index unless the encrypted-folder contract explicitly permits safe handling.

**Agreement evidence:** B's page/OCR cache, H's scanner/index and I's storage Clear use the same lifecycle and account for every retained blob. A test table must cover clear while a consumer is reading and file changes during a pending render.

## I2 — Handler capabilities, preview and rich metadata

**Providers:** A for preview/metadata; B for PDF/OCR/additional handlers. **Consumers:** C/E/F/G/H/J/K/L. **Current anchors:** `src/handlers/types.ts`, registry/openPipeline, `files.rs` grant protocol, HandlerViewProps/SaveHandle, DetailsPane and ColumnPreview.

Freeze:

- Optional capability additions to the existing Handler contract, with exact registration priority, format claims and byte signatures. Existing fields keep their meanings.
- Read-only preview request/result and cancellation, view-state bounds, returned focus/grant ownership, and which actions require explicit file-opening authorization.
- Metadata fields: canonical names/units/null/missing/error semantics for dimensions, dates/orientation, duration/codec/frame rate, tags/author/pages/words. Display formatting belongs in the existing locale service.
- PDF page/render/text/search/outline and OCR page-image/box coordinate interfaces used by converters, cleaner, PDF editor and content index. Specify rotation, origin, scale and language/config versions.
- Resource resolution for EPUB, glTF, notebooks/email and PDF: no network, parent/sibling escapes or active content. Include limits on recursive resources and decoded size.
- Unsupported/missing-pack/missing-codec/corrupt-input behavior; ordinary chosen-app fallback versus explicit text/hex actions.

**Agreement evidence:** the same image/PDF preview works in quick preview, Column, Details and converter preview without independently parsing the file or opening an editor. B and J agree file ownership before editing the PDF handler.

## I3 — Conversion, cleaning and engine adapters

**Provider:** C for the registry/job/document-input boundary; I for pack engines; K for media recipes. **Consumers:** B/J/L for exports and F for batch actions. **Current anchors:** contracts 23/24, `runJob`/`trackJob`, archive service, owned output, version hook.

Freeze:

- Converter/cleaner descriptor IDs, input/output format IDs and capabilities; option schema with exact types, default, bounds, labels/help and compatibility checks.
- Immutable document input: disk reference versus current unsaved revision; bounded authorized byte/stream grant; document revision/config key; expiry, cancellation and owner of copied buffers.
- Job request/result: request ID and current shared job polling; per-file outcomes and exact created paths/Undo data; progress units; Retry semantics; cancellation versus completed effects.
- Output policy: destination/name generation, collision/no-replace, metadata keep/remove/loss disclosure, lossy warning, before_modify reason and failure code, approved Replace dependency.
- Preview: reduced-resolution/first-page/sample input, generation revision, latest-only publication, estimates, size/time limits and preview resource disposal.
- Preset persistence: schema/validation/migration, export/import, no passwords/tokens/executable expressions; compatibility with later pack capabilities.
- Engine adapter: availability/version/licensing provenance, immutable options-to-argument translation, stdout/stderr bounds, progress, timeouts, cancellation and active-engine lease.

**Agreement evidence:** C's early converters and I's later adapters share the registry; K's exports share the same publication/cancel rules; J/L can export unsaved edits without writing the original as an intermediate.

## I4 — File effects, replacement, recovery and encrypted content

**Provider:** F, with coordinator-owned shared safety primitives. **Consumers:** C/E/G/H/I/J/K/L. **Current anchors:** contracts 8/10/11/19 and approved Replace text; `owned_io`; save.rs; transfer/history/Undo; versions. Current Replace limitations remain enforced.

Freeze:

- File-operation intent versus approved object identity; bounded approval snapshots and expiry; changed/missing/appearing destination behavior. Never accept UI paths/tokens as sufficient authority.
- Owned staging creation/flush/publication/disposal, source verification, cross-volume copy-before-remove and protected-root restrictions.
- Distinguish in-place content save from destination replacement. Fixing Replace does not automatically resolve KI-069's path race. Document which primitive each caller uses and what is still refused.
- Exact per-effect result and Undo/Redo record, partial operation recovery, cursor advancement and journal transitions before mutation. No successful summary for unknown effects.
- Bulk rename collision/cycle handling and transaction identity; failed/cancelled operation reporting across jobs.
- Encrypted-container format/lifetime boundary: plaintext temp/open/edit state; key/password scope; versions/backups/caches/index/clipboard/diagnostic exclusions; crash recovery and auto-lock while unsaved edits exist.
- Per-category cleanup and mount/profile interactions; untrusted container entries receive ordinary archive/path/bomb bounds.

**Evidence checkpoint:** research alone cannot prove safe Windows recycling/replace behavior. Coordinator executes adversarial identity/race/crash tests before enabling the capability. If the guarantee is unavailable, retain fail-safe behavior and report the incomplete feature. Do not release with an unaddressed Major simply because it predates the batch.

**Pre-release dependency:** 08d comes before 09f in the roadmap. Any existing Major needed for release must be fixed as a separately reviewed earlier F task or keep 08d unaccepted; do not claim the release passed while waiting for 09f. Whole 09f implementation need not be moved into 08d.

## I5 — Tabs, sessions, transfer and split ownership

**Provider:** E. **Consumers:** A/D/F/G/J/K/L. **Current anchors:** tabs.ts/SessionData, TabStrip, openPipeline, dirty/save registration, session serializer and drag/clipboard services.

Freeze:

- Additive folder/file/group/split identifiers and state; exactly one permanent Explorer; independent folder locations/listings/selections; dirty document identity distinct from visual container identity.
- Versioned session/group payloads: bounded view state, missing-file placeholders, selected side, child ownership, active/history order and validation/migration. No serialized file grants/passwords/live handles.
- Command context and focus ownership for tab changes, docked ribbon, active split side, close/Save/Discard/Cancel and whole-group close. Retain user data if any prompt cancels.
- Typed content-transfer kinds, formats and authorization: supported text/cells/images/pages; immutable revisions; source/target loss disclosure; no executable markup or shell commands.
- View adapters for position/zoom/search and optional sync-scroll; feedback-loop suppression and incompatible-view handling.
- External-open single-instance message validation and association flow; no bypass of chosen-app/protected-view/file-grant policy.

**Agreement evidence:** G's tab settings use E's reducer; J/K/L register through the same dirty/save/transfer adapters; closing a split/group cannot discard hidden dirty children.

## I6 — Settings, customization and registry extension

**Provider:** G for new configuration; coordinator owns canonical schemas; E/H/D contribute domain fields. **Consumers:** all streams. **Current anchors:** Rust CURRENT_SCHEMA/TS SETTINGS_SCHEMA_VERSION = 11; SettingsSection registry/reset/search; layout/theme/command/menu services.

Freeze:

- Every field's canonical section/type, Rust/TS defaults, allowed values, normalization versus rejection, migration and import/export privacy behavior. Use the existing add-settings-field recipe; coordinator reserves schema increments in included-step order.
- Per-step schema input/output numbers must be assigned after proposals reveal which steps actually add settings. No arbitrary “one bump per worker”, no workers racing to claim schema 12 and no guessed all-in-one schema for the full roadmap.
- Existing type additions stay additive/defaulted and update every literal/test consumer. Settings UI search/reset, measurement settings and prior-version tests change together.
- Context-aware shortcut ownership/resolution and key/code semantics; defaults and conflict policies across tabs, palette, tags, editors and accessibility.
- Home/navigation/status registration descriptor shape and stable IDs; G's 10e supports E's existing saved groups and H's later tags/views without duplicate frameworks.
- Profile/data-root selection and store namespaces; switches/migrations with active jobs, engines and unsaved documents; portable writability and fallback.
- Setup/theme import schemas, safe resource resolution, optional personal data and inert CSS/font/image rules. Accessibility/contrast constraints survive customization.

**Agreement evidence:** coordinator provides a single ordered migration chain and key reservation list; every worker's setting request maps to it. New labels are centrally merged from worker English/es tables and pseudo is generated only by reviewer.

## I7 — Queries, item sources, tags and storage

**Provider:** H. **Consumers:** A/E/F/G/I and future viewers/editors. **Current anchors:** Explorer item/listing/selection contracts, metadata/cache services, view mode interfaces.

Freeze:

- Bounded paged item-source abstraction for real folders versus query/smart/Timeline/Gallery results; stable identities, sort/filter order, continuation, partial error and cancellation semantics.
- Query grammar and saved-query schema, locale-independent canonical field IDs, text/date/size/regex bounds and no semantic AI backend.
- Index revision/watcher reconciliation, opt-in source/content policy, online-only behavior and no unapproved scan scope expansion.
- Tag ID/name/color validation, file-ID/path linking, rename/copy/cross-drive propagation, Undo and optional explicit metadata write.
- Size metrics: logical versus allocated, cloud-reported sizes, sparse/compressed/hard-link counting, pending partial totals and invalidation.
- Duplicate evidence freshness and actual file-effect execution through I4; never recycle from a stale UI result alone.

**Agreement evidence:** F cannot pass a smart-folder ID as a filesystem destination; G's metadata columns load without delaying basic listing; I can account for and clear indexes with active reads safely.

## I8 — Packs, storage, process lifecycle and release

**Provider:** I for packs/storage/engines; D for release/accessibility acceptance. **Consumers:** all pack-backed features. **Current anchors:** setup-core manifest/signature/download code, ADPERASTRA_DATA_DIR/data-root policy, shared jobs/helper.

Freeze:

- Signed manifest/version/compatibility/dependency schema; exact permitted download/signature/checksum policy, finite sizes and owner-started installation. Do not change signed bytes silently during JSON parsing.
- Versioned install/staging/activation/rollback/remove, leases while engines use binaries, crash/cancel/disk-full behavior and owned-path checks.
- Capability discovery/missing-pack errors and a normal App storage route; optional packs never silently become a runtime prerequisite for basic browsing.
- Storage-category registration, physical byte reporting, caps, retained/pending/open artifacts, clear effects and active leases. Respect encryption-specific exclusions.
- Full background-control additions to I1; engine warm/idle/unload and per-user/offline/portable behavior.
- License provenance for actual bundled binaries/fonts, replaceable LGPL structure, notices/source links and exclusion of GPL components. A brand/package name is not proof of binary licensing.
- Release artifact inputs, excluded private/test/developer resources, checksum/attestation plan, optional updates and data-preserving uninstall. No release publication by workers.

**Agreement evidence:** removing a pack disables its dependent features without crashing unrelated tabs; a release report names every unavailable/excluded capability and open acceptance item.

## I9 — Editing document and project adapters

**Providers:** J for image/PDF; K for media; L for Office; I for Office read-only/process boundary. **Consumers:** C/E/D and their other editor peers. **Current anchors:** optional Handler editing fields, SaveHandle, useUnsavedChanges, version hook, ViewerFrame/ToolbarDock.

Freeze common responsibilities first, format-specific models second:

- Stable document ID/revision, dirty/save/discard callbacks and immutable export/transfer snapshot. Views/splits/previews do not each create an independently authoritative document.
- Undo/Redo scope, status/search/navigation/zoom adapters and enabled/pressed command-state subscription; failures/cancellation preserve recoverable state.
- Protected view, before_modify/version errors, no-replace output and unsupported-content preservation. No custom save path that circumvents I4.
- Image: pixel/orientation/color/alpha/tile coordinate basis; extendable layer/mask/selection/history/project model; schema/version/unknown data and memory budgets.
- PDF: B's page/text/annotation/form representation and preservation limits, standard output interoperability and inert resources.
- Media: rational time base/frame rounding, clip/source references, preview/export graph equivalence, proxies/waveforms and missing-source relink; no executable project expressions.
- Office: engine-neutral command/state/document/view/selection and capability interface, unsupported content and round-trip tests. Engine-specific implementation is contingent on 20a evidence and owner approval.
- Presentation styles: same master/theme/layout IDs and content mapping as 22a; eight manual style definitions and safe own-template import for partial 22b. No second AI-specific slide model.

**Agreement evidence:** C exports unsaved state, E moves content across tabs without losing ownership, D changes a manual deck style without replacing its content, and viewers still work if an editing pack is absent.

## Freeze priority and independent work

1. Review existing interfaces first; no need to redesign a working contract.
2. Freeze I1/I2 early to unblock A/B/C; I4's current fail-safe output and I5's common tab/document ownership should be confirmed concurrently.
3. Freeze I3/I6/I7/I8 proposals so C/F/G/H/I have stable seams. I8 must account for A's early policy; later pack work cannot rename it casually.
4. Freeze engine-neutral I9 immediately enough for J/K/L/D to write non-engine-specific work. Refine format internals with their provider, keeping external contracts stable.
5. Hold only specific unsafe/unproved mechanisms or engine-specific bodies. All unrelated source writing continues.

This sequence is a priority list for contract review, not a requirement to finish an entire earlier step before another worker may write code. The critical path is settled interfaces plus the actual engine/safety decisions, not the number of workers available.
