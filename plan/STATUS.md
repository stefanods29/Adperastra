# Status

The agent updates this file at the end of every step (AGENTS.md section 4).

**Current step:** `07f` (handoff integration in progress). Steps 07a, 07b, 07c, 07d and 07e are integrated and committed on `codex/integrate-handoffs`; the latest full gate has 722 Rust and 692 UI tests passing. KI-096 was fixed during 07e, so 07e has no open Blocker or Major; its packaged-app checks, speed runs and screenshots remain pending. Packaging and owner checks for the earlier steps, and speed/screenshot evidence, remain pending; tags stay at 03b. The integration order and remaining review defects are tracked in `docs/integration/INTEGRATION-PLAN.md`. All 54 remaining guides and per-step prompts are written; their handoffs are preserved outside Git under `handoff/`.
**Last tag:** `v0.0.6-step03b` (local)
**Next step tag:** `v0.0.7-step04a`

## Steps

States: `done`, `in progress`, `waiting for owner`, `ready` (full recipe with the code: build it by copying exactly), `guide` (precise guide without code: every decision, the order of the work and the tests are given; you write the code exactly as it describes), `outline` (not written yet: stop and tell the owner, see `plan/EXPANDING.md`).

Guides for the steps after 05a are written into `plan/steps/` (`plan/EXPANDING.md`). If the next step's file is missing or its state is `outline`, stop and tell the owner, unless the decisions log below gives you the planner role (AGENTS.md section 5, "A step without a guide").

| Step | Name | State | Tag |
|---|---|---|---|
| 00 | Plan, design inventory, contracts, Git setup | done | v0.0.1-step00 |
| 01a | Setup window and first-run pack checklist | done | v0.0.2-step01a |
| 01b | App shell, tokens, theme, languages, help, security base | done | v0.0.3-step01b |
| 02 | Browse folders, Home page, command registry | done | v0.0.4-step02 |
| 03a | Selection, Details pane, command bar, right-click menu | done | v0.0.5-step03a |
| 03b | File operations, jobs, undo, drag and drop, paste as file | done | v0.0.6-step03b |
| P2 | Adopt plan v2 (tools and plan files, no app changes) | done | (none) |
| 04a | File tabs, file access, file-type handlers, image viewer | in progress (hand checks left) | v0.0.7-step04a |
| 04b | Ribbon framework, text and code viewer, Markdown viewer | in progress (speed, screenshots, hand checks left) | v0.0.8-step04b |
| 04c | Audio and video player, protected view, Open as text/hex, Default apps | in progress (speed, screenshots, hand checks left) | v0.0.9-step04c |
| 05a | View modes: List, Icons, Tiles, Content | in progress (speed, screenshots, hand checks left) | v0.0.10-step05a |
| 05b | Column view | in progress (speed, screenshots, hand checks left) | v0.0.11-step05b |
| 05c | Movable toolbars and panels, layout presets | in progress (speed, pseudo-locale screenshots, hand checks left) | v0.0.12-step05c |
| 05d | Appearance, built-in themes, Settings page | in progress (speed, pseudo-locale screenshots, hand checks left) | v0.0.13-step05d |
| 06a | Text editing | in progress (speed, screenshots, hand checks left) | v0.0.14-step06a |
| 06b | Version history | in progress (local integration checked; owner checks, full speed comparison and shared issues left) | v0.0.15-step06b |
| 06c | Templates in the New menu | in progress (local integration checked; owner checks and full speed comparison left) | v0.0.16-step06c |
| 06d | Archives: open, browse, extract | in progress (speed, screenshots, hand checks left) | v0.0.17-step06d |
| 06e | Archives: create, passwords, RAR | in progress (speed, screenshots, owner checks, real 7-Zip RAR trial left) | v0.0.18-step06e |
| 06f | Tables (CSV), JSON, fonts, hex search | in progress (speed, screenshots, owner checks left) | v0.0.19-step06f |
| 07a | Thumbnails, cache store, helper process, background work v1 | guide | v0.0.20-step07a |
| 07b | Quick preview and rich file info | guide | v0.0.21-step07b |
| 07c | Gallery | guide | v0.0.22-step07c |
| 07d | PDF viewer | guide | v0.0.23-step07d |
| 07e | Copy text from images and scans (OCR) | guide | v0.0.24-step07e |
| 07f | More previewers 1: e-books, notebooks, email, subtitles, logs, SQLite | guide | v0.0.25-step07f |
| 07g | More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD | guide | v0.0.26-step07g |
| 08a | Converter 1: Quick Convert, job queue, image formats | guide | v0.0.27-step08a |
| 08b | Converter 2: PDF, documents, sheets, archives, batch presets | guide | v0.0.28-step08b |
| 08c | Privacy cleaner | guide | v0.0.29-step08c |
| 08d | First release (v0.1) | guide | v0.1.0 |
| 09a | More tabs and sessions | guide | v0.1.1-step09a |
| 09b | Tab groups and saved groups | guide | v0.1.2-step09b |
| 09c | Dragging between tabs, content between tabs, opening files from Windows | guide | v0.1.3-step09c |
| 09d | Explorer extras and the command palette | guide | v0.1.4-step09d |
| 09e | Bulk rename and batch actions | guide | v0.1.5-step09e |
| 09f | Copy window and conflict window | guide | v0.1.6-step09f |
| 09g | "What's using this file?" and the shelf | guide | v0.1.7-step09g |
| 09h | Crash recovery, report a problem, safe mode | guide | v0.1.8-step09h |
| 09i | Split view | guide | v0.1.9-step09i |
| 09j | Disk images and clipboard history | guide | v0.1.10-step09j |
| 09k | Locked folders | guide | v0.1.11-step09k |
| 10a | Themes: editor, day and night, wallpaper accent | guide | v0.1.12-step10a |
| 10b | Toolbar and keyboard customization | guide | v0.1.13-step10b |
| 10c | Tab options, date and size formats, behavior, profiles, portable mode | guide | v0.1.14-step10c |
| 10d | Folder colors, icons, backgrounds, column sets | guide | v0.1.15-step10d |
| 10e | Menu editor, Home, sidebar and status bar customization, setup files | guide | v0.1.16-step10e |
| 10f | Accessibility (v0.2) | guide | v0.2.0 |
| 11a | Search index, search modes, speed pass | guide | v0.2.1-step11a |
| 11b | Tags, smart folders, views | guide | v0.2.2-step11b |
| 11c | Storage view, duplicate finder, folder sizes | guide | v0.2.3-step11c |
| 12a | Pack manager, App storage, Background work page | guide | v0.2.4-step12a |
| 12b | Converter 3 (media, documents), privacy cleaner 2 | guide | v0.2.5-step12b |
| 13 | Accurate Office viewers (v0.3) | guide | v0.3.0 |
| 14a | PDF tools | guide | v0.3.1-step14a |
| 14b | Basic image editor | guide | v0.3.2-step14b |
| 14c | Local AI runtime and AI upscaling | guide | v0.3.3-step14c |
| 15 | Audio and video basics | guide | v0.3.4-step15 |
| 16 | Windows integration and release polish (v0.4) | guide | v0.4.0 |
| 17a | AI assistant: core, safety, models, evaluation | guide | v0.4.1-step17a |
| 17b | Local AI actions | guide | v0.4.2-step17b |
| 17c | AI search and organizing | guide | v0.4.3-step17c |
| 17d | AI for scans and PDFs, writing suggestions (v0.5) | guide | v0.5.0 |
| 18a | Advanced image editor: layers and selections | guide | v0.5.1-step18a |
| 18b | Advanced image editor: painting, filters, project format | guide | v0.5.2-step18b |
| 19a | Video timeline: tracks and clips | guide | v0.5.3-step19a |
| 19b | Video timeline: effects, audio, export | guide | v0.5.4-step19b |
| 20a | Office editing: engine spikes and integration | guide | v0.5.5-step20a |
| 20b | Word-style editing | guide | v0.5.6-step20b |
| 20c | AI for documents | guide | v0.5.7-step20c |
| 21a | Excel-style editing | guide | v0.5.8-step21a |
| 21b | AI for sheets | guide | v0.5.9-step21b |
| 22a | PowerPoint-style editing | guide | v0.5.10-step22a |
| 22b | AI for decks and the style library (v1.0) | guide | v1.0.0 |

## Local implementation review log

- 2026-10-31: The 06b/06c batch review corrects incomplete/unsafe snapshot publication, cross-process store coordination, exact/stable restore IDs, pending/open budgets (1 GiB each), bounded preview/decompression, 2,000-row history pages, and safe new-name version copies. Existing-destination copies remain unavailable under KI-030. Restore retains the shared final ReplaceFileW limitation (KI-069); the older Save/Save as defects (KI-068) are documented under the owner's existing-error policy.
- 2026-10-31: Template creation authorizes/copies the same opened source, pins approved roots and destination, creates owned staging and publishes without replacement. It uses additive shared jobs for progress/cancel; optional list diagnostics preserve partial errors. Focus selects the intended template; folder persistence and creation are awaited, with errors retained in the picker. The picker width/max-width are 640px within the viewport.
- 2026-10-31: Review introduced no new external library. Allowed transitive notices were completed; build-only image parser advisories are bounded/deferred as KI-070 because the generator contains no image input. No forced override or version downgrade.
- 2026-10-31: Full gate: 349 Rust/462 UI tests. The release app was built without bundling/signing. Scoped checks completed 20 functional assertions per language (en/light, es/dark, pseudo/light), including exact restored/undone bytes, contrast and bounds; 12 screenshots were visually inspected. Actions measured about 29–32ms. Each run still fails its console-clean check on two style CSP violations (KI-075); runtime is not entirely clean. The original fixed-green dark diff was corrected using accent/surface tokens. Older regression speeds and owner checks remain pending.
- 2026-10-31: `measure-ui.ps1 -Review06bc` uses fresh retained data/fixtures and never invokes legacy permanent cleanup. Test processes are closed through their own job handles. The original unscoped runner is not authorized for this review. No project/worktree/build/session was deleted; no remote operation or main change was made.

## Owner decisions log (newest first)

- 2026-11-02: All54 worker handoffs received. Owner now authorizes the coordinator to integrate the parts, fill missing implementations, compile/test/debug/package and install required libraries/development tools. This supersedes the earlier planning-only stopping point. Continue locally in dependency order; preserve the submitted handoffs, keep main/remotes/publication untouched, and retain genuine owner engine/distribution checkpoints. The integration branch is codex/integrate-handoffs; original submissions have a verified external backup recorded in docs/integration/incoming-manifest.json.

- 2026-11-02: Guide-authoring scope now includes all54remainingsteps, including14c,17a-d,20c,21b and full22b. Finish complete guides with exact cross-step APIs and create one prompt per step under plan/prompts/, then stop; do not implement or dispatch coding work. Workers write code/tests without compilation/installation/execution; coordinator handles later verification. The assistant must offer Local AI or API-key mode, with Meta Model API first in the API provider list. API sends require explicit reviewed payload consent and protected native credentials; no automatic cloud fallback. This supersedes the earlier non-AI-only scope while retaining local-only Git/no publication rules.

- 2026-11-01: The owner requested complete guides for parallel non-AI code writing. The coordinator authors every full step guide and exact cross-step dependency/export tables before dispatch; coding workers do not write their own guides or choose missing names/designs. Workers write code and tests but do not compile, run tests, install dependencies or build prototypes; the coordinator executes verification/integration. The initial coordination packet is in `plan/parallel/README.md`; assignment briefs are not finished step guides. Step states and milestone promises remain unchanged. Seven AI-only steps are excluded; 22b retains only manual style-library work and remains partial.
- 2026-10-31: The owner asked to fix the two open Blockers, KI-068 and KI-079, before Step 07a. Following the contract's fail-safe branch, Save as onto an existing file is unavailable until Step 09f can tie recycling to the approved file (KI-087).
- 2026-10-30: The owner asked the agent to check the Step 05d theme screenshots instead of reviewing them personally.
- 2026-10-30: Step 05c side and bottom designs approved from the T10 screenshots.
- 2026-10-30: Coding agents building a step only document existing errors in `KNOWN_ISSUES.md`; they do not fix them. They fix only failures their own changes for that step caused.
- 2026-10-30: Build faster, in parallel where it is safe. Coding agents work in separate git worktrees. Skip the full test run after each task: each task runs a quick check (formatting, compile, translations, IPC check, UI build), and the tests each step lists are still written. The full gate runs once per batch, before a step is merged into local `testing`; speed runs and screenshots run one at a time after that. Still local only: no push, pull request, tag on `main`, or `main` change.
- 2026-10-30: Step 03b accepted. Skip repeated full test runs while building later steps; run the full suite at the end. Use subagents and git worktrees to build independent steps in parallel. Keep everything local: no push, pull request, or `main` change. Shared contracts and `plan/rules.md` still win over speed.
- 2026-10-30: Step 03b safety review. Replace is removed until the full conflict window can bind recycling to the exact approved item; the conflict dialog offers Merge (folders), Skip and Keep both, approved from a revised preview. New items, downloads and pasted files count from one ("report (1)"); copied items that keep both use Explorer's "report - Copy"; moved items use "report (1)". Keep the step local-only: no push, pull request, or `main` change. Replace is KI-030 (Minor deferral, owner-approved).
- 2026-10-30: Continue locally from Step 03b through the roadmap without waiting between steps. Do not push, pull, create pull requests or releases, publish, or change `main`; use local `testing` and local tags. Run `scripts/test-all.ps1 -Full` before and after merging each step until P2, then `scripts/gate.ps1 -Package`. Record owner-only actions and problems that remain after five genuinely different attempts in `OWNER_TODO.md`; prepare releases without publishing. Developer tools may be installed per-user, and libraries that pass R-LIC may be added following the dependency recipe. The initial review found no questions requiring an owner decision.
- 2026-10-30: `plan/` is the only plan folder. The `adperastra-plan-*` folders were deleted, and the files Step P2 still needs (the new agent files and scripts) moved to `plan/p2-files/` until P2 puts them in place. Plan changes go directly into `plan/`, in their own `docs(plan)` commit; older entries that mention plan folders or plan updates no longer apply.
- 2026-10-30: Speed checks that are merely unreliable (timeouts that come and go, noisy numbers) do not block a step; only a result that is clearly slow for the user does. The narrow click space in the address bar with long paths is accepted. The one slow recycle + restore measurement (2.2 s) is left for later.

- 2026-10-29: Continuous work. The agent goes from step to step without waiting for the owner. When a step's checks pass and no Blocker or Major is left open, it merges the step into `testing`, puts it on `main` through a pull request once CI passes, tags it, tells the owner in one short message, and starts the next step. When something breaks, it fixes the cause itself and writes down what it changed; it stops only in the cases in AGENTS.md section 5. Publishing a GitHub release still needs the owner's yes. The owner checks finished steps afterwards, and problems they report become `F` tasks. This replaces "The owner still checks and approves every step" in the planner-role entry below.
- 2026-10-29: The coding agent also has the planner role. It builds the steps in this file's order; for every step still in `outline` it first writes the guide itself (`plan/EXPANDING.md`, into `plan/steps/` on the step branch, its own `docs(plan)` commit), then builds it. The owner still checks and approves every step. Never commit `CLAUDE.md`, `.claude/` or `.mcp.json` (excluded on purpose in `.git/info/exclude`), and commit messages never name AI tools.
- 2026-10-29: The "bzip2-1.0.6" license is allowed (`plan/rules.md` R-LIC-1). Step 06e adds bzip2 archives (`.bz2`, `.tbz`, `.tbz2`, `.tar.bz2`) and bzip2-compressed entries in zip and 7z files.
- 2026-10-29: The plan zips are kept extracted in `adperastra-plan-*` folders inside the repository folder and never committed. Step 05a is written as a guide. The planner writes the next guides into the newest plan folder (`adperastra-plan-v2.1`), and the coding agent copies them in when the owner asks (AGENTS.md section 8).
- 2026-10-29: Steps P2, 04a, 04b and 04c have full recipes with the code. From 05a on, steps are written as precise guides (every decision, the order of the work, names, types, tests; no full code), delivered in plan updates.
- 2026-10-28: Plan v2 adopted: prescriptive recipes, `scripts/gate.ps1`, generated pseudo-locale, IPC check; v1 steps 04a-10c split into smaller steps (`plan/roadmap.md` lists where every v1 feature went).
