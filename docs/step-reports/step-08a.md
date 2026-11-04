# Step08a integration report

Date: 2026-11-03. Implementation integrated locally on integrate-handoffs. No remote, main, tag or release changes. Packaged UI acceptance remains pending.

## Implemented

Quick Convert from Explorer commands, context menu, command bar and image tabs; PNG/JPEG/WebP/BMP/GIF/TIFF outputs and isolated SVG-to-PNG conversion; matching preview options, loss acknowledgments, shared jobs, cancellation, retry and completion refresh. Originals stay unchanged and output publication refuses replacement.

Native immutable snapshots use authorized MIME types, bounded raw protocol uploads, retained exact file handles or zeroizing sensitive memory, document/revision/content identity, expiry and a concrete PDF snapshot resolver. Text and Markdown expose the optional current-model capture binding for document adapters; current image tabs have no unsaved editor and use their original file. Document conversion is Step08b, image editing Step14b.

Settings schema16 adds quality90, preserve-metadata, source/ask destination and one/two parallel jobs, with migration and invalid-value tests. Added English/Spanish help and generated pseudo-locale.

## Integration corrections

Preserved original handoffs. Reconciled actual managed Arc services, helper frames, cache leases, snapshot resolver and pinned-source APIs. Fixed unavailable little_exif0.6.0 pin to approved available0.6.23 in its earlier plan commit, TIFF seekable output, library exports, EXIF test API and compiler errors. Added public conversion facade and retained SHA-256 snapshot identity. Updated previous settings tests for the deliberate schema addition without removing assertions.

The snapshot registry now performs periodic idle cleanup, retaining live leases and releasing their budget after the last lease. A regression covers this lifecycle. Uploads reject oversized bodies before duplicating or dispatching them. Unsupported file extensions advertise no image converters. Dialog close cannot discard a running conversion. Added an editor-model test that captures two unsaved revisions without reloading disk.

## Verification

Full gate passed875Rust tests and808UI tests in151files after the snapshot cleanup correction; formatting, warning-as-error Clippy, translations1263keys/62help pages, IPC151commands/152calls and production UI build passed. The final gate including the public facade also passed with the same counts (TEMP/adperastra-08a-gate11.log). Implementation commit:3ba4c4b.

Built the actual debug executable and ran5 synthetic, in-memory child-process checks: preview resize, conversion resize and exact output hash/length, JPEG transparency acknowledgment refusal, explicitly acknowledged JPEG conversion, and malformed snapshot-frame refusal. Evidence: docs/integration/step08a-helper-check.json; repeat with scripts/check-08a-helper.py. The checks never open the Explorer or read the signing folder. Helper semantic errors are framed error replies with a successful process exit; the checker validates the reply rather than mistaking process exit for conversion success.

Approved license declarations for all38new locked registry packages were checked from downloaded manifests; inventory: docs/integration/step08a-dependencies.json. All are within the existing allowed license families.

## Limits and remaining acceptance

Conversion Undo is visibly unavailable before running and on completion until09f supplies exact-object recovery receipts; no path-only destructive Undo is installed. This is the explicit T7 permitted boundary, not completed Undo acceptance. Previously recorded issues remain visible.

No packaged UI screenshots, full release-helper cancellation/timeout exercise, large-batch speed tier, cloud/provider-device check, full metadata fidelity matrix or owner hand checks are claimed. Current debug-helper checks do not establish packaged-app acceptance. Required remaining evidence stays on the roadmap.

## Check by hand

In the packaged app, select synthetic PNG/JPEG/GIF/SVG fixtures, choose Convert to, select an output folder, inspect preview and loss warnings, convert, cancel a batch and retry failures. Confirm original hashes and existing destination contents stay unchanged. Check Spanish dark, pseudo-locale, keyboard access and200%zoom. Rebuild the package from this source before these checks; the retained older package is not evidence for08a.
