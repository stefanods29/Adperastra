# Submitted handoff review

Inventory baseline: `626675f801c0fc0166096704a9721157be8daba2`. This is a static intake audit, not implementation acceptance. All 54 handoff READMEs were scanned for task/status/gap declarations and all payload/proposal paths were inventoried; key Office/AI contracts and selected native bodies were read. No build, test, installation, model/API call or runtime measurement was performed by this audit.

All 2606 original manifest entries still match their preserved SHA-256; failures:0. The original backup is recorded in incoming-manifest.json. No contribution was replaced or discarded.

The payload trees contain2322 copies for2239 unique canonical targets. There are83 duplicate targets:80 identical17d/root duplicates and3 differing definitions. The118 recovered root files comprise80 byte-identical17d copies plus38 unique12b files. Step12b is therefore not empty merely because its own directory contains onlyREADME.

## Completion must not be inferred from folder presence

Every step is an unverified source candidate. Eight packets explicitly declare substantial partial task bodies:09e,10d,19b,20a,20b,20c,21a,21b. Additional packets have essential production adapters or capabilities missing, notably13,14c,17a/b/c and18b. Others still need shared wiring, dependency/API reconciliation, meaningful executed checks and runtime acceptance.

The all 54 guide/prompt delivery did not prove that every written contract was implementable without amendments. Workers correctly reported several genuine gaps instead of guessing. The coordinator should fix those centrally and finish missing code; no owner permission is needed for routine interface completion consistent with project rules.

## Canonical-path conflicts

- `src-tauri/src/document_types.rs`:08b defines sanitized HTML/conversion blocks;09a defines native document state/errors. Preserve09a ownership and move08b DTOs to a conversion-specific module with its imports/tests. These files cannot be copied over each other.
- `help/en/background-work.md` and Spanish counterpart differ between07a and12a. Treat12a as an ordered content extension, retain07a instructions until12a lands, and reconcile links/locale catalog once.
- The80 identical17d/root duplicates need one reviewed import each. Keep all originals in preserved handoffs; do not apply each duplicate twice.

No proposed payload target collides with a file in immutable baseline626675f. This does not make cross-step extension proposals or shared-root edits safe to apply blindly.

## Concrete corrections and unfinished implementation

### H01: Different document_types.rs meanings collide:08b sanitized conversion blocks versus09a native document model.

Steps: 08b, 09a. Severity:Major.

Keep09a canonical document_types.rs; move08b conversion DTOs to a converter-specific native module and change its imports/registrations/tests together.

Evidence: `handoff/step-08b/files/src-tauri/src/document_types.rs`, `handoff/step-09a/files/src-tauri/src/document_types.rs`.

### H02: Source identity equality/directory capture and bounded cache byte access required by consumers are not consistently provided.09e and10d left substantial bodies unwritten.

Steps: 07a, 07b, 09e, 09f, 10d. Severity:Major.

Add one authoritative directory identity/stamp route without content hydration; derive/implement required equality; freeze cache reader signatures; complete actual handle/journal/catalog adapters.

Evidence: `handoff/step-07b/README.md`, `handoff/step-09e/README.md`, `handoff/step-10d/README.md`.

### H03: GrantedBacking reader/range, pack root/version, confined protocol-child launcher, accurate Office input/PDF-page adapters and native indexed-image authority are absent or inconsistent.

Steps: 07d, 08a, 12a, 12b, 13, 14c, 17c. Severity:Major.

Implement canonical native adapters once at producing modules; retain grant/pack/source leases and classification. Wire concrete implementations, not abstract trait promises.

Evidence: `handoff/step-12b/README.md`, `handoff/step-13/README.md`, `handoff/step-14c/proposals/shared-edits.md`, `handoff/step-17c/README.md`.

### H04: Pack extraction/install is proposed on a blocking in-process job; R-SEC-9 requires bounded risky-parser helper isolation.

Steps: 12a. Severity:Blocker.

Move archive validation/extraction into the bounded pack helper before registering install/activation; preserve signed hashes and owned cleanup.

Evidence: `handoff/step-12a/README.md`.

Progress 2026-11-06: the fixed `--pack-helper` framed protocol, 1 GiB job
object, parent wall/cancel limits, independent `verify_staging` before
`activate_verified`, and the fail-closed install path are written (not built
or tested). Install still returns `packs.unavailable`: the production signed
catalog source, completed-download handoff, production probe and 12b artifact
hashes/signatures/licenses are not configured.

### H05: C++host dispatch accepts onlytask6 upscale. Llama and Whisper bridges explicitly return unsupported.17a provides protocol/policy but no productionTurnEngine/reqwest execution;17b has no concrete Whisper/PCM/microphone providers.

Steps: 14c, 17a, 17b, 17c, 17d, 20c, 21b, 22b. Severity:Major.

Implement native llama/vision/speech/embedding dispatch and model operators, selected-backend TurnEngine/HTTP adapters, explicit native dialogs/consent and concrete AudioGraph/PCM sources. Keep local/API choices and Meta-first behavior. Test with synthetic HTTP servers before real accounts.

Evidence: `handoff/step-14c/files/native/ai-host/main.cpp`, `handoff/step-14c/files/native/ai-host/llama_adapter.cpp`, `handoff/step-14c/files/native/ai-host/whisper_adapter.cpp`, `handoff/step-17a/proposals/shared-edits.md`, `handoff/step-17b/README.md`.

### H06: Timeline graph cannot represent placement/gaps/video compositing; capability data lacks codec/filter facts; preview title/transition representation and stream-index input are incomplete. Native export and full UI are unwritten.

Steps: 19a, 19b, 12b. Severity:Major.

Extend canonical typed render graph with placement/composition/fit/pad facts, probe-bound stream IDs and signed codec/filter inventory; add title glyph raster API; then implement native graph/export and compare preview against output.

Evidence: `handoff/step-19b/README.md`.

### H07: 20a lacks canonical base DTO/controller/AI proposal/native engine bodies; includes chart discriminant collision, unnamed wire fields, absent saved-content discard SPI and unspecified command names.20b/21a lack full editor hosts/command registries.

Steps: 20a, 20b, 20c, 21a, 21b, 22a, 22b. Severity:Major.

Freeze complete canonical TS/native DTOs and IPC names, separate chart diff tag from chart kind, add typed atomic discard-to-saved, implement controller/proposal/draft/lease layers, then finish consumer hosts and commands. This neutral work can proceed before engine choice.

Evidence: `handoff/step-20a/proposals/contract-gaps.md`, `handoff/step-20b/README.md`, `handoff/step-21a/README.md`.

### H08: Office context cannot be mapped to authorized selected-scope AI input/arguments; document image/object/protected-span/window metadata and sheet hidden-row/header/statistics/diff-paging receipts are unspecified.20c/21b withheld orchestration.

Steps: 17a, 20a, 20c, 21b, 22b. Severity:Major.

Create native selected-context-to-AiInputRef bridge retaining exact scope/classification/revisions; specify context windows, selected objects/protected facts, sheet visibility/statistics and complete diff pagination; reconcile schema task registration. Never substitute a whole-document upload or caller trust flag.

Evidence: `handoff/step-20c/proposals/contract-gaps.md`, `handoff/step-21b/proposals/contract-gaps.md`.

### H09: 18b native commands/helper transport/model import and optional-extension roundtrip are missing.14b tile validation rejects(0,0); multi-layer commits use one-layer validation and18a imports a missing model getter.

Steps: 14b, 18a, 18b. Severity:Major.

Fix zero-based tile validation, use shared layered validator, add native project import/capture/PSD bridge and streaming codec with retained optional extension payloads; complete compositor wiring.

Evidence: `handoff/step-18b/README.md`.

### H10: Native PDF/Office/OCR extractors and search/tag mirror methods are absent;17c uses ordinary modes as semantic placeholders and UTC/native versus IANA/TS relative dates diverge.

Steps: 11a, 11b, 11c, 17c. Severity:Major.

Implement producer-owned bounded extractors, canonical identity and tag replay; add explicit semantic result mode at shared type boundary; use one authoritative timezone resolver; keep partial coverage truthful.

Evidence: `handoff/step-11a/README.md`, `handoff/step-11b/README.md`, `handoff/step-17c/README.md`.

### H11: Existing-file document commit and approved-object Replace/recycle remain deliberately unavailable; cleanup is not a completed feature while capability=false.

Steps: 09a, 09f, 11c, 20a. Severity:Major.

Research/prove complete object-bound mutation/recovery mechanism and implement it if compatible with rules; retain safe new-name copy/export meanwhile. Owner approval cannot replace missing safety proof.

Evidence: `handoff/step-20a/proposals/contract-gaps.md`, `handoff/step-11c/README.md`.

### H12: Office engine comparison protocol exists; actual candidate comparison, selected licensed Windows binding and owner choice do not.

Steps: 20a. Severity:Major.

Coordinator first runs licensed Windows/local-only candidate spikes and prepares real fidelity/security/performance/license comparison; then ask owner to choose an actually feasible route with evidence. Do not ask for an uninformed brand choice now.

Evidence: `handoff/step-20a/new-files/docs/office-engine/comparison-protocol.md`.

### H13: Modern Windows context-menu distribution/signing identity decision remains open; classic integration is a separate independent feature.

Steps: 16. Severity:Major.

Prepare concrete compliant identity/distribution alternatives and unsigned inspectable artifacts first; owner chooses before machine/account/certificate changes.

Evidence: `handoff/step-16/README.md`, `plan/steps/step-16.md`.

### H14: Source/model pins do not establish production runtime/model pack hashes, signatures, license inventory, confinement or inference quality.

Steps: 12a, 12b, 13, 14c, 17a, 17b. Severity:Major.

Build/audit exact artifacts under coordinator authorization; retain real hashes and canary/model parity/evaluation evidence. Obtain owner-supplied credentials/cost consent only when a concrete authorized real-provider check is ready; never read protected signing storage.

Evidence: `handoff/step-12a/README.md`, `handoff/step-12b/README.md`, `handoff/step-14c/README.md`.

## H15: ignored and nonexecuting evidence tests

Nine submitted tests are marked ignored (09g,12b,14c). Several12b bodies do not execute the promised behavior even if enabled: sandbox_canary_denied and cancel_kills_descendants only check environment-variable presence; sink/output preservation tests similarly only check ADPERASTRA_MEDIA_PACK.14c real_host_network_denied checks a preexisting text marker containing denied. These are scaffold/evidence placeholders, not actual confinement/cancellation/output assertions. A normal gate skips them, and merely setting variables or creating a marker would create a false pass.

Replace them with real helper/process/output tests under explicit required acceptance gates, with retained actual probe output and hashes. Do not disable or weaken existing tests to obtain green. Evidence: handoff/incoming-root/files/src-tauri/src/engine_security_step12b_tests.rs; engine_conversion_step12b_tests.rs; handoff/step-14c/files/src-tauri/src/local_ai_security_step14c_tests.rs. The JSON report records all nine declarations.

## Office and AI readiness

20a delivers only7 source/test files in its payload, plus protocol/help/proposals. Canonical Office types/controller/proposals/lease/native bindings are missing.20b explicitly lacks DocumentEditor, documentCommands, DocumentBackstage and recovery;21a lacks SheetEditor and executable command wiring.22a has more authored UI but imports those absent producers.20c/21b generation and acceptance orchestration is largely withheld for specified scope/type gaps.22b cannot become an actual generator by copying its UI alone.

Local AI is not complete:14c `main.cpp` accepts onlytask6/upscaling; llama_adapter.cpp and whisper_adapter.cpp return unsupported.17b foreground/inpaint files supply preprocessing pieces but do not replace the missing common dispatcher/Whisper implementation.17a has useful pure parsers, consent registries and DPAPI pieces, but its proposed service constructor installs no TurnEngine/scope dialog. No production implementation of TurnEngine or reqwest transport was found in17a payload; only test TurnEngine implementations exist. These are real implementation tasks, not account questions.

Do not enable advertised capabilities until concrete providers are bound and validated. A fail-closed unsupported result is safer than fake success, but does not complete the promised feature. The Local/API Meta-first choice remains the required behavior.

## Review and integration order

1. Integrate07a foundation in a small reviewed batch. Establish canonical identity/directory metadata/cache reader APIs now, so later packets stop inventing variants.
2. Integrate07d backings/helper transport and08a snapshots/conversion, resolving bounded byte-reader lifetimes before12b/AI consumers. Resolve08b/09a native module collision before copying either later definition.
3. Complete09a controller/commit/recovery boundaries and09e/10d real adapters; retain unsupported destructive capabilities until proved. Apply shared registrations/settings/locale extensions in one coordinator-owned sequence.
4. At12a/12b, implement isolated pack parsing and real confined process/session/input APIs. Native/pure adapters must use actual producer shapes, not every assumption listed in12bREADME.
5. Finish13 accurate-page/input/Find adapters,14b/18a zero-based/layered model fixes,18b native project pipeline and19b graph/render gaps.
6. Complete native Local/API AI execution, source-scope authority and speech/microphone providers. Synthetic/no-credential tests can exercise transports and policy before asking the owner for actual account access or paid calls.
7. Freeze/implement the Office-neutral producer contracts and selected-context AI mapping while preparing the concrete engine comparison. After the actual owner checkpoint, bind the selected engine and complete consumers.
8. Per accepted task/batch, coordinator executes the relevant test/build gate, then real security/fidelity/manual/speed/screenshot evidence. No tests are skipped or weakened to turn a source candidate into an accepted step.

152 unique canonical source files meet or exceed400 lines. Many contain colocated tests, but that is still not an automatic exception to the guide rule. Split types/algorithms/native adapters/tests without changing public contracts; the exact inventory is in handoff-status.json.

## Owner decisions to prepare, not ask prematurely

- Office engine: execute the supplied comparison protocol and show only feasible, licensed Windows/local routes with actual retained fidelity/security/performance evidence before requesting20a choice.
- Modern Explorer menu: prepare concrete identity/distribution alternatives and reviewable unsigned artifacts before asking for16 decision or machine/account/certificate changes.
- Credentials/cost/signing/publication: ask only for the exact action when concrete integration is ready. No API key is needed to fix DTOs, HTTP adapter code, local model bridges, contracts, test fixtures or native file safety.

Object-bound recycling and existing-save safety are engineering proof obligations, not decisions the owner can waive by clicking Yes. Model/runtime artifacts need actual hashes and canary/quality evidence; folder presence and mocked tests cannot substitute.

## Per-step intake status

- **07a** — source candidate unverified; 38 effective payload files; [README](../../handoff/step-07a/README.md).
- **07b** — source candidate unverified; 34 effective payload files; [README](../../handoff/step-07b/README.md).
- **07c** — source candidate unverified; 21 effective payload files; [README](../../handoff/step-07c/README.md).
- **07d** — source candidate unverified; 45 effective payload files; [README](../../handoff/step-07d/README.md).
- **07e** — source candidate unverified; 23 effective payload files; [README](../../handoff/step-07e/README.md).
- **07f** — source candidate unverified; 73 effective payload files; [README](../../handoff/step-07f/README.md).
- **07g** — source candidate unverified; 64 effective payload files; [README](../../handoff/step-07g/README.md).
- **08a** — source candidate unverified; 49 effective payload files; [README](../../handoff/step-08a/README.md).
- **08b** — source candidate unverified; 33 effective payload files; [README](../../handoff/step-08b/README.md).
- **08c** — source candidate unverified; 38 effective payload files; [README](../../handoff/step-08c/README.md).
- **08d** — source candidate unverified; 33 effective payload files; [README](../../handoff/step-08d/README.md).
- **09a** — source candidate unverified; 37 effective payload files; [README](../../handoff/step-09a/README.md).
- **09b** — source candidate unverified; 25 effective payload files; [README](../../handoff/step-09b/README.md).
- **09c** — source candidate unverified; 31 effective payload files; [README](../../handoff/step-09c/README.md).
- **09d** — source candidate unverified; 29 effective payload files; [README](../../handoff/step-09d/README.md).
- **09e** — explicitly partial source; 25 effective payload files; [README](../../handoff/step-09e/README.md).
- **09f** — source candidate unverified; 27 effective payload files; [README](../../handoff/step-09f/README.md).
- **09g** — source candidate unverified; 28 effective payload files; [README](../../handoff/step-09g/README.md).
- **09h** — source candidate unverified; 34 effective payload files; [README](../../handoff/step-09h/README.md).
- **09i** — source candidate unverified; 20 effective payload files; [README](../../handoff/step-09i/README.md).
- **09j** — source candidate unverified; 37 effective payload files; [README](../../handoff/step-09j/README.md).
- **09k** — source candidate unverified; 49 effective payload files; [README](../../handoff/step-09k/README.md).
- **10a** — source candidate unverified; 34 effective payload files; [README](../../handoff/step-10a/README.md).
- **10b** — source candidate unverified; 27 effective payload files; [README](../../handoff/step-10b/README.md).
- **10c** — source candidate unverified; 33 effective payload files; [README](../../handoff/step-10c/README.md).
- **10d** — explicitly partial source; 20 effective payload files; [README](../../handoff/step-10d/README.md).
- **10e** — source candidate unverified; 40 effective payload files; [README](../../handoff/step-10e/README.md).
- **10f** — source candidate unverified; 36 effective payload files; [README](../../handoff/step-10f/README.md).
- **11a** — source candidate with known missing capabilities or adapters; 48 effective payload files; [README](../../handoff/step-11a/README.md).
- **11b** — source candidate with known missing capabilities or adapters; 54 effective payload files; [README](../../handoff/step-11b/README.md).
- **11c** — source candidate with known missing capabilities or adapters; 41 effective payload files; [README](../../handoff/step-11c/README.md).
- **12a** — source candidate with known missing capabilities or adapters; 39 effective payload files; [README](../../handoff/step-12a/README.md).
- **12b** — source candidate with known missing capabilities or adapters; 38 effective payload files; [README](../../handoff/step-12b/README.md).
- **13** — source candidate with known missing capabilities or adapters; 54 effective payload files; [README](../../handoff/step-13/README.md).
- **14a** — source candidate unverified; 38 effective payload files; [README](../../handoff/step-14a/README.md).
- **14b** — source candidate unverified; 46 effective payload files; [README](../../handoff/step-14b/README.md).
- **14c** — source candidate with known missing capabilities or adapters; 62 effective payload files; [README](../../handoff/step-14c/README.md).
- **15** — source candidate unverified; 34 effective payload files; [README](../../handoff/step-15/README.md).
- **16** — source candidate unverified; 36 effective payload files; [README](../../handoff/step-16/README.md).
- **17a** — source candidate with known missing capabilities or adapters; 86 effective payload files; [README](../../handoff/step-17a/README.md).
- **17b** — source candidate with known missing capabilities or adapters; 94 effective payload files; [README](../../handoff/step-17b/README.md).
- **17c** — source candidate with known missing capabilities or adapters; 61 effective payload files; [README](../../handoff/step-17c/README.md).
- **17d** — source candidate unverified; 80 effective payload files; [README](../../handoff/step-17d/README.md).
- **18a** — source candidate unverified; 31 effective payload files; [README](../../handoff/step-18a/README.md).
- **18b** — source candidate with known missing capabilities or adapters; 34 effective payload files; [README](../../handoff/step-18b/README.md).
- **19a** — source candidate unverified; 42 effective payload files; [README](../../handoff/step-19a/README.md).
- **19b** — explicitly partial source; 30 effective payload files; [README](../../handoff/step-19b/README.md).
- **20a** — explicitly partial source; 13 effective payload files; [README](../../handoff/step-20a/README.md).
- **20b** — explicitly partial source; 48 effective payload files; [README](../../handoff/step-20b/README.md).
- **20c** — explicitly partial source; 21 effective payload files; [README](../../handoff/step-20c/README.md).
- **21a** — explicitly partial source; 44 effective payload files; [README](../../handoff/step-21a/README.md).
- **21b** — explicitly partial source; 38 effective payload files; [README](../../handoff/step-21b/README.md).
- **22a** — source candidate with known missing capabilities or adapters; 61 effective payload files; [README](../../handoff/step-22a/README.md).
- **22b** — source candidate with known missing capabilities or adapters; 86 effective payload files; [README](../../handoff/step-22b/README.md).

Detailed path/hash/collision/task-declaration records: [handoff-status.json](handoff-status.json). Source preservation record: [incoming-manifest.json](incoming-manifest.json).
