# Office editing engine comparison protocol

Status: [Windows bootstrap preflight](results/libreofficekit/26.8.2.2/preflight.md) recorded. No engine has been selected or approved.
Authority: plan/steps/step-20a.md, office-edit-1, D2–D9 and T3–T5.
Only the coordinator performs this protocol. Coding workers do not download,
install, build, launch engines or create measured result records.

## Current evidence for the Windows decision

- [Native LibreOfficeKit](results/libreofficekit/26.8.2.2/preflight.md)
  demonstrated Word mutation, then failed to retain a custom XML part and
  timed out opening the Excel and PowerPoint fixtures. The separate
  [0.1.3 worker](results/libreofficekit/0.1.3/preflight.md) rendered all three
  families in the Windows sandbox. Its tested interface is read-only.
- [Collabora Office desktop 26.04](https://www.collaboraonline.com/blog/collabora-office-26-04-release/)
  ships a Windows WebView2 app with a local engine. The vendor documents
  application capabilities, but the supported third-party embedding route
  remains unverified. The [Online integration SDK](https://sdk.collaboraonline.com/CO-SDK-manual.pdf)
  describes a server and WOPI host, which does not meet this project's
  local engine requirement.
- [ZetaOffice](https://zetaoffice.net/demo2.html) demonstrates browser-hosted
  editing with LibreOffice WASM and defaults to fetching those assets from a
  CDN. The isolated offline WebView2 configuration and the distribution
  inventory are still unverified.
- The [targeted OOXML mutation probe](results/ooxml-preservation/preflight.md)
  is the strongest tested candidate for a limited local text and cell editor
  across the three requested families. It preserves untouched package parts
  in the tested fixtures and reopens through the isolated LibreOffice renderer.
  An approved binding would need an allowlist of exact operations, safe copy
  publication, resource limits, and separate acceptance for each family.

These results support continued evaluation of the local OOXML fallback.
They do not complete T4 or record the required selection under D3.

## Admission and fixed candidates

Evaluate Collabora desktop technology, ZetaOffice/ZetaJS and native
LibreOfficeKit separately. These are candidate names, not license, Windows,
embedding or import/export claims. Record the exact distribution and every
bundled component before admitting a candidate. Do not substitute Collabora
Online server hosting for supported local desktop integration.

A candidate without an upstream-supported Windows 11 route is **infeasible**.
Do not report a Linux prototype, remote service, compatibility layer or product
marketing page as Windows evidence. A mandatory remote document service is
infeasible. ONLYOFFICE, AGPL components and paid Univer import/export are
excluded. Any basic-editor fallback needs its own explicit owner selection,
permitted component inventory and proven Office I/O; no such fallback is chosen
by this document.

For each candidate record exact version, source commit, distribution URL,
artifact SHA-256, Windows architecture, support evidence, build instructions and
all component versions. Hash actual retained bytes; never use placeholder
hashes. Distinguish an upstream source hash from the hash of a locally built
binary. Record toolchain, build flags and produced artifacts for a reproducible
build. Missing support, distribution, source or license evidence stays pending
and prevents activation.

Keep a component-level inventory with component, version, source, license
identifier, license text, notices, redistribution obligations, linkage and
replaceability. Audit dependencies, fonts, bridge code, JavaScript/WebAssembly
and runtime assets separately. A permissive wrapper does not establish the
license of the engine it embeds. Identify each LGPL boundary, the corresponding
source and the replacement procedure. No private signing-key storage is read.

## Retained corpus

Use a fresh retained review root, never overwrite owner files, and enumerate it
in `corpus-manifest.json` using the adjacent schema. The manifest stores paths
relative to that root, never source content, credentials or a sensitive file.
The ordinary fixtures below contain synthetic data. Sensitive tests use a
native memory fixture and record only an opaque case ID and observed policy.

- Document: DOCX, two pages, heading/body/table/image, comment and reply,
  tracked insertion and deletion, footnote, unknown custom XML relationship.
- Workbook: XLSX, two sheets, text `000123` and `=literal`, SUM(1,2) with result
  3, both 1900 and 1904 date variants, chart, pivot, validation, conditional
  rule and unknown extension.
- Deck: PPTX, three slides, master/layout/theme, notes, image, chart, fade and
  an unsupported animation that must be preserved.
- ODT/ODS/ODP equivalents; RTF and legacy DOC/XLS/PPT only with legitimate
  retained fixtures and honest format-specific support reports.
- Protected/hostile cases: download-zone source, macro part, external
  relationship, DDE/link, ZIP bomb, path traversal and malformed part.

Record source byte count and SHA-256 before opening. Record expected feature
IDs, part names and relationship IDs explicitly; retain canonical XML or
structural comparisons so namespace/prefix changes can be distinguished from
lost semantics. Never treat a matching screenshot as preservation proof.
Owner-supplied Office-exported reference PDFs are optional evidence: mark absent
ones `pending`, not a zero-difference result. Retain their actual hashes when
supplied. Do not invent missing files to complete a manifest.

## Isolated throwaway spikes

Create spikes outside the app. Reuse the 12b EngineHost confinement boundary and
verified 12a pack lease contract; do not invent an unrestricted process launcher.
Prove the Windows confinement actually denies network and unauthorized files.
A job memory limit alone is not proof of filesystem/network confinement.
Use a controlled canary environment, not owner content or installed Office
profiles. Disable macro execution, external link updates, DDE, OLE activation,
external data refresh, remote fonts and media.

All parse/calculation/rendering occurs in a helper. Pin the exact pack lease
for each live session, including an attempted removal/update. Enforce: four
live edit sessions, one mutation per session, queue 32, aggregate memory 2 GiB,
input 512 MiB, expanded package 1 GiB, 100,000 package entries, compression ratio
500 and nesting depth 64. DTOs are at most 768 KiB; authorized raw chunks at most
8 MiB. Test boundary and over-limit cases. Snapshot capture is additionally
limited to the existing 08a 256 MiB per-snapshot/1 GiB aggregate authority.

Open timeout 60 s, transaction 10 s, export 120 s; cancellation kills an
unresponsive helper within 250 ms. A warm editing engine expires five minutes
after its final session. Dirty sessions are never evicted without recovery or
an explicit user decision. Distinguish these editing limits from step 13's
read-only bridge limits and protocol.

Sensitive input/output/profile/swap/autosave/log/render data must remain in
native memory or the encrypted provider. A candidate lacking a proved memory
route returns `office_edit.sensitive_unsupported` before materializing anything.
Ordinary recovery reuses 09h DPAPI records; no second recovery store is allowed.

## Repeatable procedure per fixture and family

1. Record machine/Windows/build/engine/font inventory and corpus revision.
2. Record pre-open source hash and supported/blocked capability report. The
   engine receives immutable authorized input, never a writable owner path.
3. Open, render the same pages/sections and compare with the retained reference.
   Save side-by-side images, difference images, parameters and reviewer notes;
   missing reference means pending visual evidence.
4. Apply a single typed body-text, cell or slide-text edit through the
   application-owned command mapping. Record one Undo entry, revision increment
   and new content identity. Verify failed/cancelled operations leave content,
   selection and history unchanged. Retry the identical transaction ID and
   reject the same ID with a different payload.
5. Capture immutable encoded revision R; edit to R+1 during capture/save.
   Confirm captured bytes still identify R and saving R leaves R+1 dirty.
6. Write only a new owned output; reopen it and compare feature inventories,
   part relationships, styles, comments/replies, revision IDs, formulas, charts,
   pivots, masters, animations, embedded objects, custom XML and unknown parts.
   Unsupported preserved content must survive; inability blocks existing save.
7. Exercise Undo/Redo and verify content identity restoration with monotonically
   increasing public revisions. Two views share one document session; closing
   one retains the other's edits. Save a copy never cleans/rebinds the original.
8. Exercise timeout, helper crash, cancellation, output overflow and invalid
   encoded magic/MIME. Verify original hashes and any foreign files remain
   unchanged and only owned temporary state is cleaned.
9. Verify macros/external resources never execute, downloaded files start in
   protected view, missing pack/version mismatch refuses, lease removal waits,
   and sensitive input either remains protected or is refused before any spill.
10. Record post-open/render/edit/capture/export/failure source hashes separately.

Existing-file publication remains unavailable unless the canonical document
commit path proves the approved identity, source stamp, version hook and
publication mechanism. Do not use this comparison to bypass KI-069 or 09f's
Replace-disabled contract. Version-hook failure means zero source writes.

## Timing, resource and UI report

Retain five real cold runs and five real warm runs per candidate/format/fixture,
with raw durations, cache reset method, warm definition, median and spread.
Never fill missing runs with estimates. Record first view, ready, transaction,
scroll frame distribution, capture and export separately. Record peak helper
and process-tree memory (including WebView/WASM), shared pool aggregate, idle
memory, on-disk download/install/profile/cache sizes and startup impact. Record
the measurement tools and sampling interval.

Targets stay fixed: ribbon ready 100 ms; warm transaction 100 ms; cold open
1–10 s with cancellation/progress beyond; scrolling 16 ms/frame. Compare each
existing interaction with the prior step JSON; more than 20% regression remains
a failure. Record unmet limits rather than changing their tier.

The report matrix has one row per candidate/family and columns for Windows
feasibility, visual fidelity, structural preservation, cold/warm speed, peak
RAM, installed disk size, license/source/notices, UI control, security,
sensitive route and reproducible Windows build. Each cell is supported by
retained evidence or explicitly pending/failed/infeasible. Do not average away
a failed preservation/security requirement.

The command mapping records each typed operation and capability, its exact
candidate-specific API/version/source, cancellation/transaction behavior and
unsupported cases. Demonstrate our ribbon/keyboard/accessibility controls
without exposing the engine's toolbar, HTML or raw engine command escape.
Check keyboard-only use, 200% zoom, all docking sides, English/light,
Spanish/dark and pseudo-locale. Animated presentation parity requires real
animation evidence, not static PDF rendering.

## Results and checkpoint

Only actual executions populate
`docs/office-engine/results/<candidate>/<version>/`. Retain corpus hashes,
rendered differences, cold/warm runs, peak memory, component license inventory,
command mapping, source-unchanged hashes, build recipe and failures. Do not
create a measured-results directory for an unrun candidate.

Recommend one documented route per document/sheet/deck family, including
explicit inability where appropriate. Fallback order: accurate read-only
view/conversion; an explicitly approved basic editor with permitted components
and proven Office I/O; chosen external application.

**OWNER CHECKPOINT:** retain the owner's explicit selection or fallback,
exact version/source commit/artifact hash/licenses/notices/source availability
and replaceable LGPL boundaries. Only then may T5 implement the approved binding
and the coordinator register dependencies, pack entrypoints and proven
capabilities. No approval is implied by this protocol or a mock test.

## Reviewer checks

- No remote document service or unverified license assertion.
- Exact distribution and component versions, hashes, source and notices.
- Unsupported Windows route marked infeasible.
- Unknown parts/review data/formulas/charts/pivots/masters/animations retained
  or existing-save capability disabled before editing.
- Real confinement, cancellation, sensitivity and source-unchanged evidence.
- Raw five-cold/five-warm samples and unchanged performance targets.
- Missing owner corpus, references and engine approval remain open evidence.
