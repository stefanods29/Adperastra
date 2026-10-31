# Step 06e report - Archives: create, passwords, RAR

Dates: 2026-10-31. Status: every task is committed on the local branch
`step-06e-archives-create`; the full gate, release build, speed runs,
screenshots and owner checks are **still to come** and belong to the
coordinator. Nothing was pushed, tagged or merged.

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

Waiting for the coordinator/owner. The list is the step file's "Check by
hand" section; none of it has been run in this session, because the owner's
brief for this batch forbids starting the app and running measurements.
The scoped runner for it is `.\scripts\measure-ui.ps1 -Review06e` (fresh
retained folder, no signing or installer).

## What works (implemented this run)

- **T1** `zip` pinned exactly to 9.1.3 with `aes-crypto` and `bzip2`
  features, `sevenz-rust2` with `compress` and `bzip2`, `bzip2` 0.6.1 with
  the pure-Rust `libbz2-rs-sys` backend, and `blake3` for spool checks.
- **T2** `fs_service::owned_io`: a pinned destination chain, guarded source
  handles and exclusively created staging files that publish with a
  no-replace rename and dispose only their own handle.
- **T3** bzip2 streams and `.tar.bz2` listing through the existing readers,
  complemented by the new owned extraction route (`secure_extract`), with
  MOTW written to the staging handle and refused rather than dropped.
- **T4** password-aware ZIP (AES and ZipCrypto) and 7z readers, per-entry
  encryption flags from the block coders, a preflight that asks before any
  write, and honest partial reports after a later password failure.
- **T5** bounded creation planning: root dedupe, nested-selection removal,
  natural sorting, hidden/online/link skips, entry/depth/text/byte caps.
- **T6** ZIP (Deflate 6) and non-solid 7z (LZMA2 6, 8 MiB dictionary)
  spool writers with AES-256 (KDF cycle power 19), optional 7z name
  encryption, ZipCrypto only when explicitly chosen, an injected output cap
  and a BLAKE3 report.
- **T7** a read-only RAR adapter: installed-7-Zip discovery under Program
  Files only, bounded technical listings split on the first ` = `, literal
  second selection, streaming into Rust-owned output, password only on
  stdin (never argv/env/disk), and refusal of volumes, links, streams,
  SFX prefixes and ambiguous names.
- **T8** session-only password memory (8 entries, LRU, identity-bound, no
  disk), redacted Debug forms, helper read options, auth-aware start
  commands that validate before a job begins, and the `archive_rar_status`
  command.
- **T9** creation jobs: validation before job/lock/spool, one creation per
  data folder through an OS lock, app-owned spool folders with an ownership
  marker, a verified parent copy with recomputed hash, numbered no-replace
  publication, and a report that keeps the actual created path for Undo.
  Follow-up F1 tightened the shared spool cap: a store already at 8 GiB
  refuses new work with `create_busy`, and the helper's output cap is
  reduced to what still fits under the same total.
- **T10** password prompt, show/hide, strength estimate as text plus a
  meter, retry-in-place on a wrong password, and session-only remembering
  (unchecked by default) in archive tabs and Explorer extraction.
- **T11** **Compress to…** in the item menu and command bar, the creation
  window (destination, name, format, encryption, password confirmation,
  optional 7z name encryption, Keep both note), cancellable job, exact Undo
  (recycle) and Redo (restore). Opening the window reads no source bytes.
- **T12** bzip2/RAR extensions claimed by the archive handler (Office
  containers stay with their own viewers), the `creating-archives` and
  `archive-passwords` help pages in both languages, updated archives help,
  the `-Review06e` scoped runner, `check-06e-ui.mjs`, and the 06e
  measurements and 49–51 screenshots in `measure-ui.mjs`.

## Not in this step (on purpose)

- No archive updating, TAR/gzip/xz creation presets, RAR creation, bundled
  7-Zip, UnRAR code or automatic download.
- No copy/paste/drag-out of archive contents (09c) and no replacing or
  merging extraction targets (09f).
- No password persistence in settings, sessions, jobs or Undo.
- No settings schema change.

## Decisions and plan changes made during the step

The guide was corrected only where the pinned APIs differ from its text, in
`docs(plan): correct step 06e API names and helpers [step-06e/plan]`:

1. ZipCrypto's public trait is `zip::unstable::write::FileOptionsExt` (the
   `zip::write` module has only a private method). Confirmed against the
   installed 9.1.3 source.
2. 7z AES options live at `sevenz_rust2::encoder_options::AesEncoderOptions`.
3. `SimpleFileOptions` has `'static` lifetimes, so encrypted ZIP entries use
   `FileOptions<'a, 'static, ()>`; the options borrow the exact password for
   the `start_file` call.
4. The guide's UTC listing switch is not named; the parser accepts a
   timestamp only with an explicit ` UTC` suffix and otherwise records 0
   (KI-081).
5. The app binary did not depend on `blake3` directly; it was added with
   `deps(app): use blake3 1.8 …` (already an approved workspace library).
6. `fs-service` uses the existing `uuid` 1 crate for random staging names
   (`deps(fs-service): use uuid 1 …`).
7. Added `OwnedOutput::keep` (verified helper spool, T6) and
   `plan_create_with_exclusion` (D8's "exclude the archive being created").
8. No startup reclamation of abandoned spool folders: the step allows
   retaining them and refusing with `create_busy`; documented as KI-082.

## Speed (development PC, packaged release build)

Not run in this session (owner's brief). The measurements are written in
`scripts/measure-ui.mjs` and `scripts/check-06e-ui.mjs`:

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Open Compress to dialog | Instant (100 ms) | not run | pending |
| Switch archive encryption option | Instant (100 ms) | not run | pending |
| Open an encrypted small ZIP after submitting its password | Fast (1 s) | not run | pending |
| Create small ZIP / AES 7z (one MiB input) | Waiting with feedback (10 s) | not run | pending |
| Large compression, source walk, RAR extraction | Background job | not run | pending |

No JSON was written to `docs/benchmarks/`; comparison baselines are still
pending as the guide says.

## Checks by hand

Not run; every Result is "waiting for the owner". The coordinator can use
`scripts\measure-ui.ps1 -Review06e` with fresh retained fixtures.

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| Create ZIP/7z, browse, exact bytes, empty folder, source unchanged | pending | pending | pending |
| Taken name gives (1), then (2); sentinels unchanged | pending | pending | pending |
| AES ZIP/7z, show/hide, mismatch, weak ZipCrypto warning only when chosen | pending | pending | pending |
| 7z hidden names on/off; ZIP names stay visible | pending | pending | pending |
| Wrong password/Cancel/retry; remembering clears on restart | pending | pending | pending |
| Undo/Redo exact archive; cancel during compression/publication | pending | pending | pending |
| bzip2 stream, concatenated members, tar.bz2, corrupt/truncated | pending | pending | pending |
| RAR with a really installed 7-Zip (hidden child, switches, stdin password, literals, empty file, volumes) | pending | pending | pending |

## Verification

- Per-task quick checks were run (no full gate, no `cargo test`, no
  `npm test` per the owner's brief):
  - `cargo fmt --all` after every Rust change.
  - `cargo clippy --workspace --all-targets -- -D warnings`: clean after
    each Rust task and at the end of T9.
  - `npm run lint:i18n`: passed (final 905 keys, 40 help pages).
  - `npm run lint:ipc`: passed (86 commands, 84 invoke calls).
  - `npm run build`: passed (only the existing chunk-size warning).
  - `npx tsc --noEmit`: passed.
- New Rust test files and names (written, not executed here):
  - `step06e_owned_io_tests.rs`: `foreign_partial_survives_create_failure`,
    `publication_never_replaces_an_arrival`,
    `cancel_disposes_only_the_owned_handle`,
    `pinned_ancestor_cannot_be_swapped`,
    `source_guard_refuses_changed_identity`,
    `flush_failure_leaves_old_names_untouched`.
  - `step06e_bzip2_tests.rs`: `detects_bzip2_and_tar_bzip2_by_bytes`,
    `reads_concatenated_bzip2_members`,
    `bzip2_tar_names_use_existing_safety_rules`,
    `bzip2_crc_failure_never_publishes_a_partial`,
    `bzip2_stops_at_injected_size_and_ratio_limits`,
    `new_extraction_refuses_required_motw_loss`.
  - `step06e_password_tests.rs`: `zip_aes_and_zipcrypto_require_the_exact_password`,
    `seven_z_reports_data_and_header_encryption`,
    `wrong_password_does_not_publish_a_zero_length_file`,
    `authenticated_selection_uses_owned_output`,
    `partial_password_failure_reports_every_effect`.
  - `step06e_create_plan_tests.rs`: `parent_selection_subsumes_its_child`,
    `unrelated_roots_with_same_name_are_rejected`,
    `walk_skips_links_hidden_online_and_denied`,
    `create_plan_caps_roots_entries_depth_and_text`,
    `empty_folders_are_explicit_entries`, `cancelled_walk_creates_no_spool`.
  - `step06e_create_tests.rs`: `zip_and_seven_z_round_trip_files_and_empty_folders`,
    `zip_aes_and_compatibility_are_explicit_choices`,
    `seven_z_encrypts_names_only_when_requested`,
    `seven_z_uses_configured_kdf_and_dictionary`,
    `output_cap_uses_small_injected_limit`,
    `cancel_and_finish_failure_preserve_sources`.
  - `step06e_rar_tests.rs`: `rar_values_split_only_the_first_delimiter`,
    `rar_duplicate_keys_and_record_injection_are_rejected`,
    `rar_lossy_name_needs_exact_second_selection`,
    `rar_real_underscore_and_at_names_are_literal`,
    `rar_duplicate_case_or_normalized_names_are_refused`,
    `rar_volume_links_streams_and_sfx_are_refused`,
    `rar_password_is_only_on_stdin`,
    `rar_failed_or_oversized_stream_never_publishes`.
  - Command modules: `archive_passwords` (auth validation, cache identity,
    LRU, redacted Debug), `archive_read_jobs` (old helper JSON, validation
    before a job, remember only after success), `archive_create`
    (validation before job/spool, incomplete reports), `archive_create_spool`
    (shared budget, owned release), `archive_create_publish` (untrusted
    spool/hash, keep both and exhaustion, cancel, late-failure report).
  - UI: `archivePassword.test.tsx`, `archiveCompress.test.tsx`,
    `archiveService.test.ts`, `archiveHelp.test.ts`,
    `archiveReviewScope.test.ts`, and updated `archiveFiles.test.ts`.
- No default multi-GB limit is allocated by any test; the small injected
  limits are used.

## Screenshots

`docs/screenshots/step-06e/`: 49-compress-dialog, 50-password-open,
51-compression-job in English light, Spanish dark and pseudo-locale are
**not taken** in this session. The code that produces them is in
`scripts/measure-ui.mjs` and `scripts/check-06e-ui.mjs`; values stay masked.
Previous steps' screenshots were not touched.

## Known issues

- New: KI-081 (Minor, pending acceptance) real 7-Zip RAR runtime unverified;
  KI-082 (Minor) abandoned app-owned spool folders are retained rather than
  reclaimed.
- Fixed: none.
- Still open: KI-068, KI-069, KI-079 (old save/extract writer paths; this
  step adds separate safe routes and does not claim to fix them), KI-075
  (existing CSP console warnings), KI-078, KI-030, KI-033 and the rest of the
  open list.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none. Dialog widths are `min(640px,92vw)` and
  `min(480px,92vw)`; the body scrolls within 80vh; fields are one column
  with 12px gaps; the strength estimate is text plus a numeric meter.
- New dependencies: `bzip2` 0.6.1 (MIT OR Apache-2.0) and its
  `libbz2-rs-sys` 0.2.6 (bzip2-1.0.6, owner-allowed); `zip` 9.1.3 pinned
  exactly (MIT) with `aes-crypto`/`bzip2`; `sevenz-rust2` 0.24 (Apache-2.0)
  with `compress`/`bzip2`; `blake3` 1.8 (CC0-1.0 OR Apache-2.0) in the app
  binary; `uuid` 1 (Apache-2.0 OR MIT) in `fs-service`. Transitive AES
  crates recorded in `THIRD_PARTY_LICENSES.md` and the dependency table. No
  UnRAR code, 7-Zip DLL or installer was added.

## Commits

```
041bbdb fix(archive): bound the shared spool budget [step-06e/F1]
6374ffc feat(explorer): Compress to with cancellable jobs and Undo [step-06e/T11]
f58e91d feat(archive): password prompts and session-only remembering [step-06e/T10]
5435f92 feat(archive): verified archive creation jobs [step-06e/T9]
23843d5 deps(app): use blake3 1.8 (CC0-1.0 OR Apache-2.0) for verified spool copies [step-06e/T9]
77719e8 feat(archive): ephemeral password sessions and helper options [step-06e/T8]
374c921 feat(archive): bounded read-only RAR adapter [step-06e/T7]
45d43e5 feat(archive): create ZIP and 7z archives in bounded spools [step-06e/T6]
e7bbad8 feat(archive): plan bounded archive creation [step-06e/T5]
889a323 feat(archive): open password-protected ZIP and 7z files [step-06e/T4]
3d6e9d1 feat(archive): read bzip2 with owned extraction [step-06e/T3]
c04a893 feat(archive): owned staging for new archive work [step-06e/T2]
4d4011f deps(fs-service): use uuid 1 (Apache-2.0 OR MIT) for owned staging names [step-06e/T2]
f784c55 deps(archive): enable passwords, creation and bzip2 [step-06e/T1]
```

## Next step

Step 06f: Tables (CSV), JSON, fonts, hex search. It has no guide in this
worktree and was not started, per the owner's brief. The full gate,
release-app checks, speed runs, screenshots and the real 7-Zip RAR check
remain for the coordinator.
