# Step07g integration report

Date: 2026-11-03. Status: implementation integrated locally on codex/integrate-handoffs. Packaged/runtime acceptance remains pending; no main, remote, tag or release change.

## Implemented

3D SafeScene viewer and isolated model loaders; isolated PSD composite/layer reader; installed Windows RAW/HEIC codec previews; AVIF fallback preserving the existing image handler; special thumbnail and metadata providers. Model-scene cache publication supports the specified256MiB result limit under the existing physical cache cap. One shared two-process WebView helper admission covers PDF/books/models/PSD.

## Integration repairs

Reconciled managed Arc services, real helper protocol/types and registry methods; bound cache keys to actual provider identity; retained source and output guards; moved helper work outside session locks; propagate cancellation and discard late results. RAW output uses budgeted, identity-bound kernel-cleaned staging. Corrected missing serialization derives, moved cursor evaluation and actual Windows COM API calls. Frontend helper registration, ArrayBuffer types, PSD document shadowing, package type declarations and AVIF fallback were reconciled with installed dependencies.

The two UI fixture repairs preserve exact assertions: byte comparison normalizes cross-realm Uint8Array prototypes; the renderer source check uses an explicit repository file path. The valid RAW request fixture now names a legitimate owned staging file; arbitrary output filenames remain rejected.

## Verification

- Native all-target compilation passed.
- Workspace warning-as-error Clippy passed before the full gate.
- Focused UI suite:45tests, initially43passed; both environment failures repaired and the affected10tests passed on rerun.
- Scene cache regression publishes, looks up and opens a5MiB scene while refusing the same oversized thumbnail, with physical usage within budget.
- Translation and IPC checks passed:1217keys/60help pages;141commands/142calls.
- Full gate is running. No complete07g test count, packaged run, visual fidelity, performance or runtime-clean claim yet.

## Dependencies

Exact three0.186.1 MIT, ag-psd34.1.0 MIT, development declarations @types/three0.186.0 MIT; direct approved zip9.1 deflate. Existing zeroize remains unchanged. Runtime npm audit returned zero findings; existing development-only findings remain recorded. No model weights, private source fixtures, secrets or binary engines committed.

## Remaining evidence

Record final gate; exercise synthetic model/PSD outputs in isolated release helpers, codec-available and missing-codec cases, cloud read refusal, source hashes, lifecycle/resource cleanup and multilingual screenshots. Hardware codec absence must remain explicit. Previously open issues stay visible. No main/remotes/tag/release changes authorized by this integration report.

## Verification runner improvement

The original isolated-fork UI run took349.34s for144files/776tests. Using Vitest vmThreads with2workers retains per-file isolation and passed the same144files/776tests in13.35s. No assertion, test selection, timeout or threshold was weakened. The bounded version-reader test imports the real Node ReadableStream explicitly because VM globals do not inherit it. Central gates now use the verified runner configuration.

## Final implementation gate

`gate.ps1` passed after all source corrections:829Rust tests,777UI tests in144files,1217translation keys/60help pages,141commands/142invoke calls, warning-as-error Clippy, formatting and UI build. Log: TEMP/adperastra-07g-gate4.log. New regressions cover equal-size texture slots, column-major translation and transformed world bounds; perspective terms remain refused. Node/primitive traversal work is bounded. Native PSD orchestration was separated into special_psd_backend.rs to retain the file-size convention.

This implementation result is not a claim that packaged helper fidelity, codecs, screenshots or speed measurements were performed. Those remain required evidence for final roadmap acceptance.
