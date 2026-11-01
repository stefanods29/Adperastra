# Parallel implementation plan: all remaining non-AI work

Prepared 2026-11-01. This is a planning deliverable. It does not start implementation, create workers, or mark any roadmap step complete.

## What the owner wants

Other AIs will write the application code concurrently, using these assignments and the project's step guides. They also write the required tests. They do **not** compile, run tests, install dependencies, generate lockfiles, package, measure performance, or take app screenshots. The coordinating reviewer performs those actions, resolves integration problems, and checks the finished work.

Read this packet in order:

1. This file: scope, project analysis, work order and ownership.
2. [ASSIGNMENTS.md](ASSIGNMENTS.md) and [ASSIGNMENTS-G-L.md](ASSIGNMENTS-G-L.md): all 47 included step assignments, grouped into 12 workstreams.
3. [INTERFACES.md](INTERFACES.md): agreements that must be settled before dependent code is written.
4. [WORKER-PROMPT.md](WORKER-PROMPT.md): the reusable instruction to paste into another AI.
5. [REVIEW.md](REVIEW.md): coordinator's acceptance and testing procedure.
6. [SYMBOLS.md](SYMBOLS.md): exact cross-step name requirements and verified baseline examples.

This packet organizes implementation; it does not pretend the 47 missing full step guides already exist. **The coordinator writes every full step guide and its cross-step symbol tables before dispatching that step for coding. Coding workers do not expand outlines, invent interfaces, or choose missing designs.** A step is not ready to dispatch until its complete guide and consumed interfaces are reviewed and frozen. Whole-step integration remains ordered.

## Scope and exclusions

There are 54 remaining outline rows in `plan/STATUS.md` at the baseline. Include 46 whole steps and the non-AI part of 22b, making 47 assignment rows. Exclude seven whole steps: **14c, 17a, 17b, 17c, 17d, 20c, 21b**.

Keep normal Windows OCR in **07e**, PDF text extraction, deterministic image filters, conventional search, document editing, and the ordinary pack framework. The exclusion is the roadmap's optional AI runtime, models, assistant, AI actions, embeddings/semantic search, AI generation and AI-specific evaluation/training.

Apply the exclusion inside mixed steps too:

- 10f: keep accessibility and Windows read-aloud; omit automatic captions dependent on 17b's speech pack.
- 11a: keep filename, text, filters and regex. Do not implement AI search modes or advertise them as working. Existing roadmap placeholders may remain disabled; their planned UI is not AI implementation.
- 12a: build generic packs/storage/background controls and non-AI packs. Do not create model installers or AI indexes.
- 14b/18b: retain manual erase and deterministic filters; omit upscaling, object removal and model-based enhancement.
- 20b: omit dictation through the excluded speech pack and AI writing suggestions. Ordinary existing spelling support can remain. A new local grammar checker needs its own verified dependency decision.
- 22b: retain **manual** style selection, the eight named styles, layout/style definitions and user-template import. Defer AI slide generation, model-driven style choice, prompt tuning and training. Label this a partial step throughout.

Do not renumber steps, recycle skipped tags, delete excluded guides, or mark AI steps done. Planning past a skipped AI step does not mean its code exists.

The original v0.4, v0.5 and v1.0 milestone promises include excluded AI work. Prepare the included work and an explicit scope report, but do not claim those original milestones are fulfilled or publish their releases. A changed release promise/version needs a later owner decision. Publishing any release still requires the owner's yes.

## Repository baseline and findings

Baseline: local `testing`, commit `0154c69b3ea5afbfadc39ffa8ee2637733396348`; working tree clean when inspected. Local tags end at `v0.0.6-step03b`. App implementation through 06f and later repairs is present locally, while acceptance evidence for several earlier steps remains incomplete. These are different facts.

Evidence read: status and recent commits; rules/conventions/pitfalls; contracts, ledger, libraries and speed policy; roadmap and all mapped non-AI v1 outlines; design/UI kit; dependency manifests; gate; handler registration/types; tab/session model; settings schema/sections; helper/job interfaces; owned-output/save interfaces; known issues and existing report inventory.

Key constraints for concurrent code:

1. `src/App.tsx`, `src/views/ExplorerHome.tsx`, `src-tauri/src/main.rs`, the settings models and registries are shared integration points. Giving each worker permission to rewrite them creates collisions even in separate worktrees.
2. Shared jobs already exist: `src-tauri/src/jobs.rs`, `Jobs`, `JobContext`, `spawn_job`, `job_poll`, `job_cancel`; `src/services/jobs.ts`, `runJob`, `newRequestId`. The active job limit is 32 and the UI polling interval is 100 ms at this baseline. Extend these instead of inventing a second job runner.
3. Helper processes already exist in `helper.rs`, archive/font helpers and the clipboard-image helper. Step 07a generalizes this work; it must retain existing consumers. A Windows job object is not a complete security sandbox: a guide must describe actual process permissions, resource bounds and file access.
4. The handler registry and `adpfile` grants already connect viewers to file tabs. New previewers and editors extend the existing contract, dirty-state handling, saves and protected view.
5. Settings schema is 11 in Rust and TypeScript. The ledger's next schema is 12; screenshot numbering next starts at 57. These are coordinator-controlled counters, not numbers every worker may increment independently.
6. User-file output already uses `crates/fs-service/src/owned_io`. Do not revive the ledger's obsolete predictable-partial-file or path-based recycling recommendations. Current code and the repaired contracts win.
7. The status introduction still names KI-068 and KI-079 as open Blockers, although their fixes are in the baseline and the issues are in the Fixed section. Do not undo those repairs or report those two as still open. KI-069 (content replacement race), KI-075 (CSP styling), KI-087 (Save as Replace unavailable), KI-033 (same-folder navigation), KI-037 (Undo reservations) and pending evidence remain relevant. Recheck their state before integration.
8. The roadmap still calls 06e an outline although its implementation and guide exist. The ledger also contains historical names and omissions. Compare code, commits and newer contract notes instead of treating any single summary as proof.
9. `plan/PROMPTS.md` contains historical prompts pointing to deleted `adperastra-plan-*` folders. Use the new prompt in this packet. Keep all new plan material under `plan/`.
10. Far-future Office editing has a real owner checkpoint in 20a: engines must be researched and compared, then approved. Planning can cover its adapter and acceptance criteria; full engine-specific editing cannot be honestly finalized before that decision.

No builds, tests or performance numbers are inferred from old status text. This analysis is static; subsequent reviewer runs supply current verification evidence.

## Roles and ownership

**Coordinator/reviewer:** writes the full guides, researches and fixes every shared interface/name, and owns shared files, the frozen interface register, guide acceptance, dependency installation, lockfiles, compilation, all executed checks, merge order, known-issue classification and final reports. Coding workers cannot declare their own work passed or supply missing design decisions.

**Workers A-L:** own the feature-specific implementation files assigned below and their feature tests/help/styles. They implement the coordinator's complete guides and frozen interfaces, and provide integration instructions. They read the rest of the project but do not modify another worker's files. A missing/incorrect guide fact goes back to the coordinator; a worker cannot quietly choose its own replacement.

The same AI can take several assignments in separate sessions; 12 assignments do not require 12 accounts or simultaneous processes. Never assign two workers the same stream concurrently. A worker may delegate inside its own stream only if the delegating worker remains the sole owner of its output and partitions files explicitly.

Use a separate checkout/worktree for each coding worker from the same reviewed base. Suggested local branches: `codex/parallel-a` through `codex/parallel-l`. Create them through the workspace's worktree tool when available. Never have several AIs switch branches or stage changes in the same working folder. Keep everything local: no pull, push, PR, main changes, tags or release publication from workers.

If a worker cannot use a worktree, it returns proposed files in its own `plan/parallel/drafts/<letter>/` folder instead of editing the live app. The coordinator later applies them. Do not share `.git` indexes or copy ignored/private data to external AIs. Give them only the relevant repository source/plan files, never signing keys, personal files or app data.

## Shared files: coordinator writes them once

Workers describe exact additions in `plan/parallel/drafts/<letter>/integration.md`. Only the coordinator applies changes to:

- Root `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`; `src-tauri/Cargo.toml` and any already-shared crate manifest.
- `src-tauri/src/main.rs`, existing managed-state roots, `src-tauri/isolation/index.html`, `tauri.conf.json`, existing capability files.
- `src/App.tsx`, `src/views/ExplorerHome.tsx`, `src/main.tsx` and root CSS imports.
- Existing shared settings, tabs, commands, menus, handlers, undo, jobs, helper, protocol and version-hook type/registry files.
- `src/i18n/locales/en.json`, `es.json`, generated `pseudo.json`; `themes/*.tokens.json` and generated tokens.
- Existing shared test files; `scripts/measure-ui.*`, packaging scripts and release workflows.
- `plan/STATUS.md`, roadmap, contracts, libraries, ledger, UI kit, known issues and dependency/license records.

A worker may create a new feature crate's manifest as a proposal in its owned tree, but the coordinator reviews and registers it. Existing files outside the list still require a named single owner. File ownership takes precedence over the apparent convenience of a small edit.

Feature source files, their dedicated test files, CSS and help pages belong to the worker named in ASSIGNMENTS. Full guides belong to the coordinator. If a shared change is too large for written instructions, return a separate patch as handoff data; do not apply it to the common checkout. The packet itself contains no implementation code.

## Work order: simultaneous writing, controlled dependencies

### P0: prepare the common base (coordinator)

- [ ] Record current commit, clean/dirty state and actual accepted baseline. Preserve existing work.
- [ ] Confirm the scope/exclusions above and retain current local-only rules.
- [ ] Create or select isolated workspaces; send each worker its letter, paths, base and prompt.
- [ ] Assign every shared file to the coordinator and reserve each feature namespace/path.
- [ ] Carry forward unresolved safety issues and incomplete earlier checks into review tracking.

Acceptance: every worker sees the same baseline and knows where it may write. No worker begins an unowned shared edit.

### P1: coordinator authors all guides and cross-step dependencies

The coordinator reads the references and source, expands each outline and fixes its dependencies before giving it to a coding worker. Each guide includes an explicit "Uses from other steps" table, naming the producing step/task, canonical file, exact exported function/type/constant/field, parameters and return/error shapes, and baseline or frozen contract revision. Local variables private to another module are never dependencies.

Each full guide follows `EXPANDING.md` sections 3-9: exact paths/names/data/algorithms, finite limits, UI structure, English/es-419 texts, full help, named tests with exact outcomes, safety/failure cases and task commits. It also lists what it exports for later steps. No implementation code belongs in a guide. Source code is delivered separately by workers after dispatch.

Coordinator draft guides have review state `draft` and `Written before | 07a was built` at this baseline. This label applies even to a late step; it names the earliest unbuilt predecessor. Update it when rebasing. Do not set canonical STATUS rows to `guide` merely because a draft exists. The assignment briefs in this packet are not those full guides.

### P2: freeze shared interfaces (coordinator, before dependent bodies)

Use INTERFACES.md. Settle provider and consumer signatures, serialized fields, errors, lifetimes, cancellation and bounded storage, including current-source compatibility. Reserve schema bumps and screenshot numbers in roadmap order. Apply additive shared type declarations to the common base only where they can compile independently, with reviewer checks. Runtime registration waits for real implementations; future settings bumps are applied with their actual step, not all at once in this base.

Distribute a new immutable base revision and accepted contract revision to all affected workers. They update their isolated workspaces without losing local changes. No fake production parser, no success-returning placeholder and no duplicated local copy of a shared type may substitute for a missing provider.

Freeze contracts in small groups. A worker need not wait for unrelated domains. Examples: preview workers need preview/cache interfaces; spreadsheet workers need the Office adapter; palette work can use the existing command registry immediately.

Acceptance: every dependency used by a coding worker resolves to baseline code or an explicit, reviewed provider contract. An unsettled contract blocks only its dependent implementation, not other work.

### P3: concurrent implementation (workers)

Each worker writes bodies, UI, tests, help and styles from the coordinator's accepted full guides. Within a stream, it may work on independent step modules concurrently once their contracts are frozen. Across streams, code can be written before the provider's implementation is finished because the exact interface is settled. If a required guide or symbol table is absent, that step is not dispatched.

Workers use file reads, source search, exact diffs and documentation only for self-review. **No compiler, type checker, linter, test runner, build, package install, formatter command, benchmark or app launch.** They write tests but mark them **not run**. They do not generate pseudo-locale, tokens, fixtures by executable generators, or lockfiles. They list those actions for the coordinator.

Workers save uncommitted changes in their isolated workspaces and preserve task boundaries in the handoff. Repository rules require successful coordinator verification before commits; “not allowed to compile” is not permission to claim a pass. No task markers, tags or completion states are forged.

### P4: review, build and integrate (coordinator)

Follow REVIEW.md. Read each returned guide and implementation, reject incompatible assumptions, install dependencies once, apply shared wiring, run formatting/checks/tests and fix errors. Use the actual roadmap order for local step integration. Do not merge an entire mixed-step workstream as one giant feature commit.

Code-writing concurrency does not erase release, engine, safety or performance dependencies. Failures go back to the responsible worker with a concrete contract/reproduction; the worker returns a code correction without running it. The coordinator reruns the relevant checks.

### P5: complete acceptance and handoff

- [ ] All included steps have reviewed full guides and implementation evidence, or a named genuine blocker/owner checkpoint.
- [ ] All written tests have been executed by the reviewer; required package, UI, speed and accessibility checks are recorded.
- [ ] Earlier unfinished acceptance work has an honest disposition; no excluded AI functionality was smuggled into a normal step.
- [ ] No open Blocker/Major is hidden by “worker finished”; original milestone claims remain unfulfilled where AI is excluded.
- [ ] Owner receives plain-language results, remaining decisions and the appropriate checklists.

## Concrete worker return format

Every stream maintains four files under `plan/parallel/drafts/<letter>/`:

1. `progress.md`: baseline SHA, contract revision, assigned steps, file ownership, step/task progress, exclusions, and **verification not run; coordinator required**.
2. `interfaces.md`: the frozen exports/imports consumed, canonical definitions and contract revision; concrete mismatches to send back to the coordinator, not worker-designed replacement interfaces.
3. `integration.md`: exact shared-file insertion points, dependency/version/features/license requests, translation rows, migration/default/test changes, registry/allowlist entries and generated actions the coordinator must perform. Separate entries by step/task.
4. `research.md`: source paths and symbols, pinned official documentation links/signatures, license/toolchain checks, worked test arithmetic, unresolved facts and design deviations.

The coordinator keeps unfinished full guides under `plan/parallel/guide-drafts/` and promotes accepted ones to `plan/steps/`. Workers do not author guide drafts. Implementations live in each worker's owned source files in its isolated workspace. Include a changed-file list and task-to-file mapping in `progress.md`; no pasted thousands-line diff in chat.

Progress labels: **researching**, **contract proposed**, **contract frozen**, **writing**, **ready for coordinator review**, **review changes requested**, **accepted**. Only the coordinator assigns accepted. Planning acceptance and runtime acceptance are separate entries.

## Restart and changes

Resume from repository/workspace files, not chat memory. Read progress, compare base revision and contract revision, inspect the diff, and continue the first incomplete task. Never overwrite another worker's uncommitted changes. A contract change requires a new revision, provider/consumer impact list and coordinator approval before dependent edits continue.

The coordinator alone promotes accepted full guides into `plan/steps/` and updates shared plan records, in their own `docs(plan)` commits. Feature commits still use the step/task messages in those accepted guides after checks pass. Do not run the ordinary “continue through the roadmap” workflow as a worker; this assignment restricts that role to its stream and centralizes executed verification.
