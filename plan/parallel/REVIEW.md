# Coordinator review, compilation and integration

This work belongs to the coordinating reviewer. Code-writing workers must not execute these checks. The owner has reserved compilation, testing and final verification for the coordinator.

## Track two kinds of readiness

**Plan ready:** full step guide is precise and consistent, required APIs/licenses are verified, interfaces are frozen, and implementation tasks have exact acceptance criteria. This does not prove the code builds.

**Implementation accepted:** reviewer has inspected the real code, run the required compilation/tests/package/runtime checks and recorded evidence. A worker handoff or written test cannot produce this state by itself.

At packet creation, the 47 full per-step guides have not been authored and future worker code has not been returned. The 47 rows are assignment briefs, not complete coding recipes or reviewed implementations. The coordinator authors full guides before dispatch. Never write a final whole-project acceptance report until outputs and required evidence exist.

## R0 — Establish review baseline

- [ ] Record actual base SHA/status, worker workspace, contract revision and task/file map.
- [ ] Preserve all uncommitted work; do not stage another worker's files or discard a failed attempt.
- [ ] Read owner decisions in current STATUS. Retain local-only restrictions and AI exclusions.
- [ ] Reconcile stale issue/status/ledger statements against code/commits before relying on them.
- [ ] Record unfinished earlier owner checks, screenshots, packaged runs and speed comparisons separately.

For this packet's baseline, KI-068 and KI-079 are fixed in committed code. Other open Major issues cannot be called fixed without proof. Do not reintroduce old unsafe save/extraction logic through historical guide snippets.

## R1 — Review each full step guide

- [ ] Each included roadmap feature has a task or an explicit justified later/excluded destination; mapped v1 scope is traced.
- [ ] Required EXPANDING sections exist, in order. Draft/conditional/ahead-of-code status is honest.
- [ ] Every path/symbol exists in the accepted predecessor or is created by a named preceding task/provider contract.
- [ ] Every guide contains exact "Uses from other steps" and "Exports for later steps" tables. Each consuming symbol/field/variant/argument matches its producer's canonical definition and frozen revision; each task names the rows it uses. No private local variable is treated as a public API, no guessed future name, and no duplicate shared type is accepted.
- [ ] Libraries are pinned and official APIs/features/licenses verified at that version. Toolchain/binary availability is proved or explicitly pending.
- [ ] UI structure, roles, keyboard/focus, loading/empty/error/busy states, layout sizes/tokens and all English/es-419 texts are specified.
- [ ] Type/setting/command/error tables are complete; no unexplained normalization, null state or unit; shared types have one home.
- [ ] Algorithms include empty/missing/oversized/denied/cloud/vanished-drive/cancel/second-click/race outcomes.
- [ ] Named tests give exact fixtures and expected results. Check arithmetic manually and preserve earlier assertions.
- [ ] Full bilingual help, hand-check files/checklist, actual speed measurement identifiers and screenshot reservations exist.
- [ ] Tasks are small, ordered and can pass reviewer-run checks at each accepted task/batch boundary. Dependency adoption remains separately reviewable.
- [ ] No implementation code is smuggled into the guide. Source implementation is reviewed separately.

Disposition per guide: accept, request concrete corrections, or mark the exact dependent task blocked by an owner checkpoint/unproved mechanism. A vague “looks good” is insufficient.

## R2 — Cross-stream contract review before assembling code

- [ ] I1-I9 changes have provider and consumer agreement at the same revision.
- [ ] No duplicate scheduler, cache, file grant, job runner, tab/document model, menu registry or Office adapter was created.
- [ ] Settings bumps, migrations, previous-version tests and measurement settings form one ordered chain from schema 11.
- [ ] New command IDs, handler IDs, key namespaces, error codes, shortcuts, help slugs and screenshot names do not collide.
- [ ] Import/export/transfer/session data excludes tokens/passwords and applies actual bounds.
- [ ] Owner-file mutation, Undo/Redo, cleanup and crash recovery retain identity/ownership safety.
- [ ] No worker wrote outside its owned files; all shared integration changes are explicit and reviewed once.
- [ ] Unsupported pack/codec/engine/capability paths fail visibly and preserve normal chosen-app behavior.

If a consumer guessed a missing API, return it for correction rather than modifying the provider to match an accidental implementation. Document any intentional additive contract change first.

## R3 — Code review before compilation

Inspect complete changed functions/modules and the actual diff, including tests. Verify:

1. Every IPC boundary checks main window/arguments, appears in handler registration and isolation allowlist, and is called only from services. IPC payloads remain bounded; file bytes use approved grants/protocol.
2. No Tauri Channel, shell-built user command, active document code, permissive iframe escape, remote resource load or weakened CSP.
3. Risky parser isolation and process limits are real. Process job limits alone are not a claim of filesystem/network sandboxing.
4. File writes use owned staging, complete flush/no-replace publication and correct before_modify hook/Undo. Cleanup touches only owned objects. Recovery remains possible after every mutation failure.
5. Async responses carry revision/cancel checks; effects/subscriptions/observers/grants/processes clean up; no synchronous disk/parser work blocks a UI/async dispatch thread.
6. Virtualization, finite allocation limits, foreground priority, online-only skips and background policy are implemented rather than asserted in comments.
7. Screens are translated/token-based and preserve focus/dirty state when docked or split. Existing required data fields/tests migrate together.
8. No unreviewed dependency, incompatible binary license, paid/pro feature, model/weight, secret, installer or >50 MB tracked file.
9. Tests check behavior and adversarial outcomes, not just that code echoes its own defaults. No skipped/deleted/weakened assertions, fake capability support or unfinished production stubs.

Use the project's review/security skills as appropriate when performing the actual code review. A security-sensitive mechanism such as encrypted folders or approved Replace warrants a separate focused review before activation.

## R4 — Coordinator-only dependency and generated work

- [ ] Adopt approved dependencies once, following the dependency recipe, checking actual transitive licenses/build features and advisories. Update lockfiles and both notice records centrally.
- [ ] Apply shared wiring from handoffs in roadmap/task order: module registration, managed state, IPC allowlist, handlers, commands, styles, settings and all callers/tests.
- [ ] Merge English/es translations with ICU argument parity, generate pseudo-locale and tokens where applicable.
- [ ] Format changed Rust and perform the task/batch quick checks required by the current owner decisions.
- [ ] Run the full gate before accepting/committing an implementation batch into local testing. Do not treat inability of workers to run it as a waiver.

The coordinator may run the repository commands in AGENTS/STATUS, including `cargo fmt --all` and `.\scripts\gate.ps1`. For final step acceptance use `.\scripts\gate.ps1 -Package` as required. Check what the packaging path currently executes before launching it, and never access the private signing directory.

Record actual command, revision, result and log path. Do not quote test totals from an earlier step as current results. If a check fails, localize the first cause, fix it or return the precise issue to the worker, and rerun the appropriate checks. Never lower thresholds or suppress failures for speed.

## R5 — Integration tests across feature boundaries

Execute these flows after the applicable providers are assembled, using retained synthetic fixtures:

- Browse a large image folder while thumbnail/OCR/index jobs compete; foreground selection/scroll remains in tier. Pause policy prevents new background reads; online-only files are never hydrated.
- Change preview file/options rapidly, switch tabs, close a split/group, clear cache and uninstall an engine while work is pending. No stale result, invalid grant, hanging process or lost dirty data.
- Export an unsaved image/document/PDF through Quick Convert and compare output to the intended revision. Cancellation/disk-full/access-denied never damages original or existing destination.
- Copy/rename/restore with changed/swapped targets, new destination races and interruption at every journal transition. Check actual bytes/identity, recoverability and exact Undo cursor/effects.
- Unlock/edit/relock a container and interrupt it. Verify plaintext is absent from ordinary caches/index/history/diagnostics and recoverable edits remain protected. Do not promise secure physical erasure.
- Reopen sessions/groups/splits with missing files, absent packs, long paths and cloud references. Protected view and explicit opening rules survive restore.
- Search/tag/move/copy/rename files across volumes; reconcile stable IDs/index entries and invalidate duplicate/hash evidence before mutating.
- Import malicious/oversized setups, projects, EPUB/model resources, PDFs, archives and Office inputs; no path escapes, macro/script execution or hidden network fetch.
- Compare native editor preview and exported/reopened results: PDFs/annotations/forms, image projects/layers, timeline timing/audio, Office formulas/review data/masters/animations.

Each full guide supplies exact fixtures and assertions. This list is an integration floor, not a replacement for its named test suite.

## R6 — Runtime, speed, appearance and accessibility

- [ ] Use a packaged release build with a fresh synthetic data root and retained fixtures. Reuse safe runner paths; do not invoke old permanent-cleanup scripts blindly.
- [ ] Run the guide's measurements and previous common interactions, comparing tiers and previous-step JSON with the required 20% rule/owner policy. Record noisy/incomplete results honestly.
- [ ] Capture English light, Spanish dark and pseudo-locale screenshots with reserved names; visually inspect clipping, translations, contrast, keyboard focus and docked layouts.
- [ ] Check clean runtime console/network behavior. A passing render assertion does not excuse CSP violations or unintended network requests.
- [ ] Test keyboard main flows throughout; at applicable acceptance run Narrator/NVDA, high contrast and 200%/300% layouts. Name unavailable hardware/owner checks rather than inventing a pass.
- [ ] Test 100,000-item browsing/sheets, large PDFs, 24 MP image work, smooth brush strokes and at least 30 fps media scrubbing where their guides require them.
- [ ] Run install/upgrade/uninstall and per-user/portable/offline scenarios for release steps; preserve owner data and validate actual bundled contents/licenses.

Only the coordinator runs these checks; workers provide proposed selectors/fixtures/expected screenshots and can fix reported defects. The original manual Office-engine comparison and owner approval remain a genuine prerequisite for engine-specific editing.

## R7 — Commit, plan promotion and local acceptance

1. Promote only accepted complete guides to `plan/steps/step-<id>.md`, update plan contracts/libraries/ledger/UI kit/status consistently, and use separate `docs(plan)` commits after required reviewer checks.
2. Integrate implementation by included-step order and task boundaries. Preserve the guide's commit messages and explicit F fixes; do not merge all late features through an earlier step's commit.
3. Record gate/package/test/runtime evidence and actual speed/screenshot results in step reports. Update known issues and changelog with observed behavior and remaining limitations.
4. Never mark skipped AI steps or partial 22b complete. Do not invent tags or claim milestone release readiness with excluded requirements or open Blocker/Major issues.
5. Keep work local and main untouched under current owner decisions. Releases require owner's explicit publication approval.

## Reviewer return format

Return a short plain-language result plus a per-step evidence record containing: base/final revision, reviewed guide/contract revision, changed scope, commands actually run and outcomes, artifact/log locations, measured performance, inspected screens, issues/fixes, deferred owner checks and final disposition.

If review is incomplete, state exactly which artifact or decision is missing. “All checked” is reserved for completed evidence, not a promise to run it later. Compilation of today's baseline verifies today's baseline only; it cannot validate code other AIs have not yet written.
