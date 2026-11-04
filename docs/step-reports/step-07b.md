# Step 07b report — Quick preview and rich file info

Date: 2026-11-02 (America/Lima). Status: local integration on `integrate-handoffs`; the
full gate runs after this report, and packaged-app verification is still pending. No remote
operation, `main` change, release or tag has been made.

## How to try it

Open `build\Adperastra\Adperastra.exe` after packaging. Select a local picture, text file, PDF
or media file in a folder and press **Space**. Use **Left**/**Right** to move between files,
**Open** to open normally, and **Esc** or **Space** to close. Select one file to see the new
details in the Details pane; turn on the Column preview to see them in Column view.

## Owner checklist

1. Press **Space** on a text file, type on the keyboard, and confirm the text does not change
   and there is no Save, Save as or dirty marker. Repeat in the Markdown viewer and with a
   media file (it must start paused and must not take focus).
2. Move through pictures with the arrow keys, check that online-only files keep the cloud
   state, and confirm that Open closes the preview and opens the file in a tab.
3. Use a folder with a JPEG that has camera and date facts, a WAV/MP3 and a document with
   author/page/word counts. Check the Details pane and Column preview in Spanish dark theme.
4. Select several files: the pane must keep the existing summary and must not mix their
   metadata. Select a folder: no metadata request runs.
5. Check the **?** buttons of the preview and the File details page open the two new help pages
   in English and Spanish.
6. Confirm the source file's bytes and modified time do not change after previewing it.

Cloud placeholders and physical drags remain explicit owner environment checks; unit tests do
not claim those real-device scenarios were performed.

## What is integrated

- Fixed-allowlist Windows property metadata (15 fields, 64 KiB serialized, 4,096-character
  text, 16 list entries, 16 missing IDs) read in the memory-limited `--metadata-helper`
  process with a 3 s budget and 250 ms cancel grace.
- One pinned read-only source and parent chain for the whole helper call, online-only and
  reparse refusal before content access, revision checks before and after, and bounded cache
  reads through the 07a cache store (`open_blob`, no second cache).
- Coalesced metadata jobs: one admission permit and one helper per cache key, independent
  consumer cancellation, late-release withdrawal, and `Jobs` registration before work.
- Production provider registry with the Windows property fallback; installed higher-priority
  providers are resolved inside the one admitted pipeline.
- One quick-preview modal per Explorer tab: Space on a file, arrow navigation without wrap,
  Escape/Space close, exact focus restoration, protected-view handling, online-only cloud
  state, and local read-only Find in supported previews.
- Read-only handler guards: text, code and Markdown previews cannot type, save, create drafts
  or report dirty state; media previews start paused and do not steal focus.
- Details pane and Column preview add rich facts without replacing the listing facts, history
  action, folder state, multi-selection summary or cloud badge.
- English/Spanish keys (1,036 total), generated pseudo-locale, two help pages and the existing
  pane/view help sentences. Settings schema stays 12; no new external dependency.

## Integration corrections

The submitted files were module fragments, so the coordinator declared them inside their
canonical parents (`metadata_jobs` owns the group/job/pipeline/start fragments,
`metadata_types` owns values, `metadata_properties` owns the Windows value reader). The
service is injected with the existing 07a `Arc<CacheService>`, `Arc<BackgroundPolicy>` and
`Arc<BackgroundScheduler>` rather than looked up under a second managed type. The metadata
helper dispatch, five new Tauri commands and their isolation allowlist entries were missing
from the payload and were added. The first locale insertion created a duplicate top-level
`metadata` object that hid the detail labels; it is now one label block plus `errors.metadata`.
The modal remembered `inert` as `undefined` and never restored `false`; it now saves the real
boolean state. The preview dialog also exposes a named export expected by Step 07c.

## Verification

- Focused 07b UI suites: 45 tests across 7 files pass (preview handler, navigation, surface,
  quick preview, metadata facts, metadata lifetime, translations).
- `cargo check --workspace --all-targets`, `npm run build`, `npm run lint:i18n` (1,036 keys,
  47 help pages, 133 TSX files) and `npm run lint:ipc` (110 commands, 111 calls) pass.
- Final full gate: `GATE PASSED` with 584 Rust tests across 51 binaries, 608 UI tests
  across 111 files, translations 1,036 keys/47 help pages/133 TSX files, IPC 110 commands
  and 111 calls, and the production UI build. The 06f JSON "Show more" test now has its own
  15 s budget because the 600-test suite exceeds the 5 s default under load; its assertions
  are unchanged.

## Speed and screenshots

Pending the packaged release build: `step07b.quick-preview.open`, cached preview,
`step07b.preview.next`, `step07b.details.basic` and `step07b.details.rich`, plus screenshots
59-61 in English light, Spanish dark and pseudo light. No speed or screenshot value is claimed
before it is measured.

## Known issues and remaining acceptance

KI-092 records the integration defects fixed here. No Blocker or Major remains open for the
code paths this step changes. The preview grant is still the 04a path grant with an eligibility
and revision check at acquisition; a same-path change after the grant is not re-read
automatically inside the preview (the Details/Column facts do refresh through the listing
revision). This limitation is recorded for the later granted-backing work (H03). Existing KI-075
(style CSP console messages) and the older owner/speed checks remain as recorded.

## Next steps

07c Gallery, then 07d PDF viewer and webview helper transport, in dependency order. The
preserved handoffs stay under `handoff/` and are not committed; the integration record is
`docs/integration/INTEGRATION-PLAN.md`.
