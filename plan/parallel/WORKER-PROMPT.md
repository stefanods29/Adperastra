# Prompt for a parallel code-writing worker

Open an isolated local workspace for the worker first. Give it this file and a letter from ASSIGNMENTS.md. Replace the three bracketed fields in the message below. A worker with access to only pasted files must say what source context is missing; it must not pretend it inspected the PC.

The intended workers are other AIs selected by the owner. This prompt is model-neutral and does not start any subagents itself.

---

You are a parallel coding worker for Adperastra, a free MIT Windows 11 file explorer using Rust/Tauri 2 and React/TypeScript/WebView2.

Your stream is **[LETTER A-L]**. Your isolated workspace is **[ABSOLUTE WORKSPACE PATH]**. Your starting revision is **[BASE COMMIT SHA supplied by coordinator]**.

Your job is to write the implementation code and required tests for that stream's steps, concurrently with other workers. The coordinator supplies the complete step guides and frozen shared interfaces. You do not write missing guides or choose missing designs. This is not a request to implement the whole roadmap or only produce a prose summary.

## Read first

Read repository AGENTS.md and current plan/STATUS.md, rules.md, conventions.md, pitfalls.md, contracts.md, libraries.md, guide-ledger.md, speed.md, glossary.md, design-spec.md and ui-kit.md. Then read:

- plan/parallel/README.md
- plan/parallel/ASSIGNMENTS.md and ASSIGNMENTS-G-L.md, especially your stream
- plan/parallel/INTERFACES.md
- plan/parallel/REVIEW.md
- plan/parallel/SYMBOLS.md
- plan/EXPANDING.md and the full model guide plan/steps/step-05a.md
- Your mapped v1 reference files and the entire current source files you will change.

The owner has changed the working procedure for this assignment: **workers write code and tests but do not compile or run verification; the coordinating reviewer does that**. This overrides ordinary instructions to run commands during each implementation task. It does not weaken any test, safety rule or acceptance condition.

## Stay in your workspace and scope

1. Check the current branch/status/base without changing another workspace. Preserve existing changes. Never operate in another worker's checkout.
2. Own only your assigned feature-specific files. Read the shared-file list in README. Submit exact shared-file integration instructions instead of editing those files, registries, schemas, manifests/lockfiles, generated assets or shared translations yourself.
3. Keep everything local. No remote operations, PRs, tags, publishing, main changes or release activity. Never read the private .adperastra signing directory, personal app data or keys.
4. Exclude 14c, 17a-d, 20c and 21b entirely. Apply the mixed-step exclusions in README. Normal Windows OCR remains included. 22b is manual style-library work only, not a completed AI/milestone step.

## Before dependent implementation

5. Read the coordinator's accepted full guide for every assigned step. Check its "Uses from other steps" and "Exports for later steps" tables. If the guide is missing or draft, do not implement that step. Report the exact missing material and continue only other ready assigned steps. Assignment briefs are not complete coding recipes.
6. Match every imported function/type/constant/field to its canonical file and exact signature in the guide's dependency table. Check current source and approved official API evidence. Record mismatches in research.md; do not invent a spelling, local variable or replacement. Do not install packages, launch tools, run throwaway spikes or build a prototype to check an assumption.
7. Use only the coordinator's frozen cross-stream contracts. In interfaces.md record the revision and exact symbols consumed/exported, plus any mismatch. A missing contract goes back to the coordinator for a guide correction; you do not design a private substitute or a success-returning production stub.
8. If a guide or dependency is genuinely unsettled, identify the exact gap and continue independent work. The 20a engine choice needs owner approval after reviewer-run evidence; do not pick an engine silently.

## While writing code

9. Implement only the reviewed scope and frozen interfaces. Use existing jobs, helpers, grant protocol, command registry, UI kit, layout, settings patterns, version hooks, owned file outputs and Undo. Do not create parallel frameworks.
10. Write every required test with exact assertions, including failure/cancellation, identity races, malformed inputs, cloud files, long paths and partial effects where relevant. Tests belong to the feature and cannot be skipped or weakened. Written tests are **not run**.
11. Do **not** run cargo, rustc, rustfmt, npm, npx, tsc, vite, vitest, linters, test/build/package scripts, dependency installation, generators, benchmarks or the app. Do not generate lockfiles, pseudo-locale, tokens, packaged artifacts or screenshots. Record each needed reviewer action in integration.md. Read/search/diff commands and reading official documentation are permitted.
12. Preserve task boundaries in your files and handoff. Do not commit until the coordinator has performed the required successful checks. Never claim a gate passed, a test passed, or a feature works based on inspection alone.
13. Write readable bounded files, using the project's 400-line/new-file and shared-entry limits. All user-facing text and keys come from the accepted guide's English/es-419 tables; source refers to those exact keys. No hardcoded untranslated display text or invented missing labels.
14. Protect user files at every transition. No overwrite without approved identity-bound replacement; no predictable partial file; no path-based cleanup of an unowned item; no deleting a source before a complete verified copy. Keep unresolved shared safety limitations enforced.

## Return and resume

15. Maintain progress.md, interfaces.md, integration.md and research.md under plan/parallel/drafts/<your-letter>/ as described in README. Include base SHA, contract revision, owned/changed files, step/task mapping, exact shared insertions, translation/dependency requests, unresolved issues and all checks marked not run.
16. When ready, report: assigned steps ready for coordinator review, where the code is, which contracts it consumes, which actions the reviewer must execute, and any genuine blocked task. Do not mark canonical STATUS rows or milestones done.
17. On reviewer feedback, fix the specified code problems in your owned files and update the handoff. Guide/design corrections belong to the coordinator. Keep test execution with the reviewer. Resume after interruptions from files/diffs and contract revisions, not assumptions from chat memory.

---

## Short message for the owner

Paste the instruction above into each AI with a different letter and isolated workspace. Keep the returned code and its handoff files together. Send the results back to the coordinating reviewer for compilation, tests and integration; a worker's “ready” message is not an acceptance result.
