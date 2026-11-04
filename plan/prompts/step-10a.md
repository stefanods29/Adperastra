# Coding assignment: step 10a — Themes: editor, day and night, wallpaper accent

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-10a.md](../steps/step-10a.md). Guide SHA-256: `dcc8847a41d3aa7a6943b3a61e431115da97e6879987673f294c67d0c89f125b`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10a-theme-editor |
| Tag | v0.1.12-step10a |
| Depends on | 05d appearance;07a cache/background;09d palette |
| Written before | 07a was built |
| Interface revision | custom-theme-1 |

Settings reservation: 27 -> 28; screenshot reservations: 114-116. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 09d producer guide](../steps/step-09d.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| ID | Producer/task; canonical symbol | Exact dependency |
|---|---|---|
| U1 | 05d `src/appearance/themes.ts`: THEMES,themeScheme(id ThemeId)->light/dark,resolveThemeId(theme,systemDark)->ThemeId | Preserve these built-in functions; custom resolution is E2, not a broadened lie about old ThemeId |
| U2 | 05d `src/appearance/applyAppearance.ts`: applyThemeAttributes(root,theme,systemDark),applyAppearanceAttributes(root,appearance) | Coordinator delegates new custom layer after legacy attributes; existing density/radius/motion semantics retained |
| U3 | 07a T2/T3/E1/E3/E5/E8 cache SourceStamp/CacheLease/decode_pixels | Cache owned theme-background decode only; source chosen explicitly; release leases on draft/root disposal |
| U4 | 09d T4/E3 PaletteRegistry.registerProvider | Theme actions register static provider, no imported executable callback |
| U5 | 05d settings defaultSettings/normalizeSettings/loadSettings/saveSettings and native validate/migrate | Bump27->28 in both languages/fixtures, default additive new fields, unknown/newer imports fail without mutation |
| U6 | 06e owned_io::OwnedOutput/ClosedOutput and fs-service::atomic_write | User export no-replace; app-owned catalog atomic. Never cleanup arbitrary path |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files, order and dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(theme): custom theme data and schema [step-10a/T1]` | customThemes.ts,custom_theme_types.rs,theme_data.rs; define DTO, whitelist, legacy migration28; coordinator settings/fixtures. U1/U5 | themeData.test.ts/native: `legacy_day_night_refs_preserved`; `unknown_token_rejected`; `url_style_rejected`; `one_hundred_first_theme_refused` |
| T2 `feat(theme): bounded theme storage and transfer [step-10a/T2]` | custom_theme_store.rs,theme_transfer.rs,theme_assets.rs; E1/E3, ownedimagecopy, atomiccatalog. U3/U6 | `failed_import_does_not_apply`; `export_never_contains_source_paths`; `collision_does_not_replace`; `image_decode_cap_precedes_allocation`; `remove_active_theme_falls_back` |
| T3 `feat(theme): live safe theme rendering [step-10a/T3]` | ThemeEditor.tsx,ThemeTokenEditor.tsx,themeResolver.ts,styles/themeEditor.css; coordinator rootapply andmaterialadapter. U1-U3/E2/E5 | themeEditor.test.tsx: draftpreviewdoesnotchangeglobalroot;cancelrestores;invalidcontrastblocksSave;materialfallbackvisible;installedfontnosourcebytes |
| T4 `feat(theme): scheduled day and night appearances [step-10a/T4]` | themeSchedule.ts,useThemeSchedule.ts,DayNightSettings.tsx; U2/E2 | themeSchedule.test.ts:419night/420day/1139day/1140night;wrapday1200night360 =>0day;equalstartsreject;overrideresetsatnexttransition;timezonechangeresolvesonce |
| T5 `feat(theme): wallpaper palette and readable accents [step-10a/T5]` | theme_wallpaper.rs,theme_fonts.rs,themeMath.ts,WallpaperAccentPicker.tsx; U3/E4/E6 | themeMath.test.ts: black/whitecontrast21;samergb1;binfrequencytiespackedRGB;transparentignored;noautomaticreadwhenoff;allchosenaccenttext>=4.5 |
| T6 `docs(help): custom themes and scheduled appearances [step-10a/T6]` | fullhelppagesbelow; docs/theme-authoring.md; coordinator keys/pseudo/registries/screenshots/measures. U1-U6 | allthemefilefieldsdocumented;English/esargumentparity;CSSwhitelisttests;oldbuiltinthemebuttoncountsupdatedonlyforseparatecustomsection |

## Coordinator commit labels (workers do not commit)

- feat(theme): custom theme data and schema [step-10a/T1]
- feat(theme): bounded theme storage and transfer [step-10a/T2]
- feat(theme): live safe theme rendering [step-10a/T3]
- feat(theme): scheduled day and night appearances [step-10a/T4]
- feat(theme): wallpaper palette and readable accents [step-10a/T5]
- docs(help): custom themes and scheduled appearances [step-10a/T6]

## Required handoff

Return `handoff/step-10a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-10a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
