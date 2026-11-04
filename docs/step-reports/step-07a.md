# Step 07a report — Thumbnails, cache and background work

Date: 2026-11-02 (America/Lima). Status: local integration on `integrate-handoffs`; final packaged-app verification is in progress. No remote operation, main change, release or tag has been made.

## How to try it

After packaging, open `build\Adperastra\Adperastra.exe`. Choose an icon view in a folder containing local pictures. Open **Settings > Background work** for the new controls.

The coordinator uses `scripts/package-app.ps1 -ReuseSetup`: it verifies and reuses the existing signed setup manifest using the public key. It never reads the private signing folder.

## Owner checklist

1. In the retained synthetic fixture folder recorded by the benchmark JSON, choose large, medium and small icons. The blue/green landscape and rotated portrait should show pictures; broken.png and notes.txt should keep their file tiles.
2. Select pictures, use the arrow keys, press F2 then Escape, open their right-click menu, and try normal file dragging and Undo with copies of test files.
3. In Background work, pause preparation, open the many folder, then resume. Opening and copying files should remain available while previews are paused.
4. Turn on Only when idle, use the computer, then leave input idle for 30 seconds. Test the charger restriction on a computer where AC state can actually change.
5. Use an already-existing online-only cloud placeholder: browsing must keep its cloud tile without downloading its content. The coordinator does not create or hydrate a cloud fixture.
6. Restart the packaged app and check that the policy/cache-size choices persist. Repeat the main flows in Spanish dark and with keyboard navigation.

Owner-only cloud/power/physical-drag checks remain explicit environment checks; passing unit tests does not claim those real-device scenarios were performed.

## What is integrated

- Local PNG/JPEG/GIF/BMP/TIFF/ICO and locally supported WebP previews in existing grids, with fallback for damaged or unsupported files.
- The Windows image parser runs in a bounded helper process. It applies all eight EXIF orientations, fits the requested edge, preserves alpha and never upscales.
- Shared cache keys use stable native identity and full precision timestamps. Cache leases keep displayed images alive through clear/eviction; release revokes access before dropping the pin.
- Storage admission accounts for the index, sidecars, pending output and foreign retained bytes. Helper output reserves its full maximum length before starting. Native object receipts govern cleanup; uncertain files are retained.
- Two active background pipelines, bounded priority admission, cancellation per consumer and policy checks at admission. Paused previews resume through one shared status poll.
- Settings schema 12, English/Spanish help and generated pseudo-locale. Existing foreground source-open policy is preserved by a separate no-recall background API.

## Integration corrections

The incoming code required fixes for physical cache accounting, source-handle substitution, foreign-file cleanup, corrupt index fields/oversized row sets, newer-schema writes, second-process index sharing, crash-cleaned staging, reserved helper-output storage, EXIF 5/7 and RGBA ordering, coalesced job cancellation/admission, late-result lease cleanup, same-path refresh and live policy status/resume. The new regressions preserve the original byte/cancellation assertions; no test was ignored, disabled or loosened.

The producing guide and contracts record additive `open_blob`, `with_staging_budget`, `open_background`, optional listing revisions and shared eligibility subscription. T2's original 100-byte physical-cache fixture could not contain a SQLite index; the corrected test uses a 2 MiB budget and 1 MiB blobs, checks total physical bytes and keeps input files outside the cache.

No new external dependency was added. `cache-store` is an MIT workspace crate using the already-approved rusqlite, BLAKE3, serde, UUID, Windows and filesystem dependencies. The submitted handoffs remain unchanged, with a verified external backup and intake manifest under `docs/integration/`.

## Verification

- Initial full gate passed: 518 Rust tests and 562 UI tests across 104 files; translation check 1,005 keys/45 help pages; IPC check 105 commands/104 calls; UI build and warning-as-error Rust lints passed.
- Final full gate after the staging reservation and late-lease repairs: 523 Rust tests across 51 test binaries and 563 UI tests across 104 files, all passing; translation 1,005 keys/45 help pages; IPC 105 commands/104 calls; UI build and warning-as-error Rust lints passed (`GATE PASSED`).
- The final UI run exposed one integration regression: releasing the last thumbnail consumer while `runJob` was still starting left a ready lease unreleased. The service now observes the late handle and releases that lease; the regression test waits deterministically for the job start and then for the release instead of assuming one microtask. No assertion was removed or loosened.
- Focused thumbnail verification passed 24 tests, including actual subprocess termination before writing, after writing and after guard handoff. Cache reservation tests exercise independent stores and a separate process. Pure idle/AC tests cover boundary/unknown inputs; a synthetic OFFLINE-attribute regression proves background refusal without changing foreground opens.
- Full gates use the same two-CPU process affinity as the previous coordinator baseline to avoid excessive UI worker contention. No test timeout or expectation was changed.

## Speed and screenshots

Pending the newly built release application. `scripts/check-07a-ui.ps1` creates fresh retained synthetic sources/data, uses an owned hidden process job, restores its environment, records real errors/network requests/source hashes and never deletes source folders. `check-07a-ipc.mjs` exercises real job/lease/cancellation commands; full queue saturation is claimed only if observed.

Screenshots reserved: `57-thumbnails` and `58-background-work`, English light, Spanish dark and pseudo light. Previous comparable browsing/selection/tab/startup rows must be checked separately where matching historical measurements exist; no comparison will be invented.

## Known issues and remaining acceptance

No release/main acceptance is claimed. Existing issues remain as recorded in `KNOWN_ISSUES.md`, including the style CSP issue KI-075, shared save replacement race KI-069 and Save as replacement restriction KI-087. Step 07a does not alter those existing paths. Real placeholder/power/physical-drag checks and prior-step missing speed comparisons remain visible.

## Next steps

07b quick preview/metadata, 07c Gallery and 07d PDF implementation repairs are being prepared in separate staging folders by separate agents. The coordinator owns shared wiring, compilation, tests and packaged-app review, and admits each step only after verification.
