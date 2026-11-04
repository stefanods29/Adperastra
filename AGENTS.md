# Adperastra: instructions for the coding agent

Adperastra is a free, open-source (MIT) file explorer for Windows 11 with browser-style tabs and built-in viewers, converters and editors. Stack: Rust + Tauri 2 (backend), React + TypeScript (UI in WebView2).

**Your role: implementer.** Every design decision is already made in this plan: libraries, file paths, names, data shapes, sizes, texts, tests. Your job is to build the steps in the order of `plan/STATUS.md`, task by task, as written, and to go straight from one step to the next without waiting for the owner. When something does not work the way the plan says, you fix it yourself (rule 4) and write down what you changed. You stop only for the few decisions that belong to the owner (section 5).

Steps come in two kinds (`plan/STATUS.md` says which):
- **ready**: the recipe contains the code. Copy it exactly, including the "find exactly / replace with" changes.
- **guide**: the guide gives every decision but no code: files, names, data shapes (tables of fields and types), the order of the work, each algorithm step by step, texts, the tests to write (names, inputs, expected results), limits, traps and checks. You write the code exactly as described. Use the names, files, libraries and versions it gives, and nothing else.

## 1. The six golden rules

1. **Do what the current task says, and no more.** Do not add features, refactor code, rename things, or "clean up" beyond the task. One exception: a bug that breaks the app, slows it down, or makes it worse to use is always in scope. Log it in `KNOWN_ISSUES.md` and fix it (section 4E).
2. **Keep the plan's decisions.** Use the libraries, versions, names, paths, types, colors and texts given in the recipe, and the recipe's code when it gives code. Change a decision only when it does not work (rule 4), and record every change.
3. **Run `.\scripts\gate.ps1` after every task.** Commit only after it prints `GATE PASSED`. Never commit failing code. Never disable, skip or weaken a test to make it pass.
4. **When something does not work, fix it.** Find the cause and fix it there; a workaround that only hides the problem is not a fix. If the plan itself is wrong (an API or file it names does not exist, the recipe contradicts itself or the code), find a solution that keeps every rule in `plan/rules.md`, correct the step file in its own `docs(plan)` commit, and note the change in the step report. Never repeat a failed attempt: when the same approach has failed twice, read the error and the code again and try a different approach. Stop only in the cases listed in section 5.
5. **Never lose or risk user data.** Follow `plan/rules.md` section R-SAFE in every change that touches files on disk.
6. **The owner is not a programmer.** Talk in plain language, keep it short, and when you need something from the owner, say exactly what to click or paste.

## 2. Where everything is

| What | Where |
|---|---|
| Current step, finished steps, tags | `plan/STATUS.md` |
| The step you are doing (the recipe) | `plan/steps/step-<id>.md` |
| Rules that always apply | `plan/rules.md` |
| How code is written here (patterns, folders, names) | `plan/conventions.md` |
| Mistakes that already happened and must not happen again | `plan/pitfalls.md` |
| How-to recipes (add a Tauri command, a setting, a help page...) | `plan/recipes/` |
| Locked library list (name, version, license) | `plan/libraries.md` |
| Existing UI components and when to use them | `plan/ui-kit.md` |
| Measured design values (colors, sizes, fonts) | `plan/design-spec.md`, screens in `plan/design/screens/` |
| English-Spanish word list for translations | `plan/glossary.md` |
| Git commands and tests | `plan/git-and-testing.md` |
| Speed limits and how to measure | `plan/speed.md` |
| Integration contracts | `plan/contracts.md` |
| Templates (step report, known issue, BLOCKED, help page) | `plan/templates/` |
| AI features (only for AI steps) | `plan/ai.md` |
| Full roadmap and milestones | `plan/roadmap.md` |
| Planner files (only when you write a guide, section 5) | `plan/EXPANDING.md`, `plan/guide-ledger.md`, `plan/PROMPTS.md`, `plan/reference/` |

## 3. Start of every session (do this first, every time)

1. Read `plan/STATUS.md`, `plan/rules.md`, `plan/conventions.md`, `plan/pitfalls.md` (OpenCode loads the last three automatically).
2. Run `git status`, `git branch --show-current`, `git log --oneline -15`.
3. If `BLOCKED.md` exists: read it. If the owner has answered in chat, follow the answer, delete `BLOCKED.md`, and continue. If not, remind the owner of the question and stop.
4. Open the current step file from `plan/STATUS.md` and read all of it. Then read only the files listed in its "Read first" section.
5. Find where the work stopped. A session can end in the middle of anything (a crash, a usage limit, a closed window), so trust the repository, never your memory:
   - **Tasks:** run `git log --oneline testing..HEAD`. Every finished task has a commit ending in `[step-<id>/T<n>]`. Continue with the first task that has no commit.
   - **Uncommitted changes** (`git status`) belong to that task. Read the diff, run the gate, repair whatever is broken or half-written, and finish the task. Only if they are beyond repair, run `git stash` and redo the task.
   - **The finish:** if every task has a commit, check how far sections 4C and 4D got (report committed? step merged into `testing`? pull request open or merged: `gh pr list --state all --head testing`? tag pushed: `git ls-remote --tags origin <tag>`? `plan/STATUS.md` updated?) and continue from the first part that is not done.

## 4. Doing a step (exact procedure)

**A. Start the step** (only if its branch does not exist yet; the branch name is in the step file):

```powershell
git checkout testing
git pull
git checkout -b <branch-from-step-file>
git push -u origin <branch-from-step-file>
```

**B. For each task, in order (T1, T2, ...):**

1. Read the whole task.
2. Change the files listed under **Files**. If another file must change to make the task work, make the smallest change that does it and list it in the step report.
3. Write the tests listed under **Tests**, with the names given.
4. If you changed Rust code, run `cargo fmt --all`. Then run `.\scripts\gate.ps1`. If it fails, find the cause, fix it, and run it again (golden rule 4).
5. Commit with the task's commit message, exactly:
   ```powershell
   git add -A
   git commit -m "<commit message from the task>"
   ```
6. After every 3 tasks, and after the last one: `git push`.

**C. Finish the step** (after the last task):

1. `.\scripts\gate.ps1 -Package` must pass.
2. Prepare the "Check by hand" list: create the test files the step file lists (ready steps give the commands; guide steps give a table of files and their content). You cannot click in the app, so the owner does these checks later in the packaged app (`build\Adperastra\Adperastra.exe`). Problems they report are fixed as `F` tasks (E).
3. Run the speed measurements listed in the step file and save the JSON in `docs/benchmarks/`.
4. Take the screenshots listed in the step file (English light, Spanish dark, pseudo-locale) into `docs/screenshots/step-<id>/`.
5. **Bug sweep.** Nothing may reach `main` that breaks the app, slows it down, or makes it worse to use. Check that:
   - every "Done when" item is met;
   - every speed result is within its tier (`plan/speed.md`) and not more than 20% slower than the previous step's JSON;
   - the screenshots match the design, with no broken layout, cut-off or untranslated text, or missing focus outline;
   - `KNOWN_ISSUES.md` has no open Blocker or Major for anything the step touches.

   Fix everything you find as `F` tasks (E), then repeat this check until it is clean. A Major may move to a later step only when its fix needs that step's work; write the step and the reason in the issue (`plan/rules.md` R-KI).
6. Write `docs/step-reports/step-<id>.md` from `plan/templates/step-report.md`. Update `CHANGELOG.md` (section `[Unreleased]`) and `KNOWN_ISSUES.md`.
7. Commit `docs(reports): step <id> report [step-<id>/report]` and push.

**D. Put the step on `main` and tag it** (no approval needed):

```powershell
git checkout testing
git pull
git merge --no-ff <step-branch> -m "merge: step <id> into testing [step-<id>]"
.\scripts\gate.ps1 -Package
git push
gh pr create --base main --head testing --title "Step <id>: <step name>" --body-file docs/step-reports/step-<id>.md
gh pr checks --watch
gh pr merge --merge
git checkout main
git pull
git tag -a <tag-from-step-file> -m "Step <id>: <step name>"
git push origin <tag-from-step-file>
git checkout testing
git merge --ff-only main
```

If `gh pr checks` fails, find the cause, fix it on the step branch as an `F` task, merge it into `testing` again, and repeat from `gh pr checks`.

Then in `plan/STATUS.md` (on `testing`): mark the step done with its tag, set "Current step" to the next step, commit `docs(status): step <id> done, next <next-id> [step-<next-id>]`, and push. Tell the owner in one short message: "Step <id> is on main as `<tag>`: <what is new, in one line>. Your checklist is in `docs/step-reports/step-<id>.md`." Then start the next step at A right away. Do not wait for a reply.

**Milestones.** When the tag is a milestone (`v0.1.0`, `v0.2.0`, ...), also prepare the GitHub release (step 08d explains how) and ask the owner before publishing it. Publishing a release always needs the owner's yes; keep working on the next steps while you wait for it.

**E. Fixing problems found later.** When the owner reports a problem, or you find one in a finished step, fix it as a new `F` task on the branch of the step you are working on: commit `fix(<area>): <what> [step-<id>/F<n>]`, with the id of the step that has the bug, and add the fix to that step's report. It reaches `main` with your current step. A Blocker comes before everything else.

## 5. When to stop and ask the owner

Stop, write `BLOCKED.md` (template: `plan/templates/blocked.md`), tell the owner in chat, and wait only when:

- The recipe says **OWNER CHECKPOINT**.
- A fix needs something only the owner can decide or do: a library whose license is not on the allowed list (`plan/rules.md` R-LIC), anything that costs money, the owner's accounts or passwords, or installing a program on their PC.
- Every fix you can find would break a rule in `plan/rules.md` (for example, it would risk user data, open a security hole, or weaken a test).
- You have tried five genuinely different approaches and the same problem still blocks the step.

Before you stop, finish every task of the step that does not depend on the answer. A step with an open Blocker or Major never goes to `main` (section 4C.5).

Everything else you decide yourself, in line with the plan and the existing code, and you write the decision down: in the step report, in `KNOWN_ISSUES.md` if it is a bug, and in the plan file it belongs to (its own `docs(plan)` commit). For example:

- **A library the recipe does not list:** pick one whose license is on the allowed list, add it to `plan/libraries.md` with the reason, and add it with `plan/recipes/add-dependency.md`.
- **A contract change:** extend the contract in `plan/contracts.md` first; never replace it (the rules at the end of that file).
- **A new settings field:** follow `plan/recipes/add-settings-field.md`.
- **A guide step that leaves something open** (a name, a file, a behavior, a text): choose what fits the plan and the existing code.
- **A problem that could lose data, or a security hole the recipe does not cover:** log it as a Blocker in `KNOWN_ISSUES.md`, then fix it.
- **A step without a guide** (marked OUTLINE, or its file does not exist): when the decisions log in `plan/STATUS.md` gives you the planner role, write the step's guide first, exactly as `plan/EXPANDING.md` says (sections 3 to 9, using `plan/guide-ledger.md`), into `plan/steps/step-<id>.md` on the step's branch, update the plan files its section 8 lists, run the gate, commit `docs(plan): guide for step <id> [step-<id>/guide]`, push, and build the step as a guide step from T1. Without the planner role, tell the owner the step needs expanding (`plan/EXPANDING.md`) and stop.

Do not ask the owner things the plan already answers. Do not ask for permission to continue, between tasks or between steps.

## 6. Never do these (full list: `plan/rules.md` and `plan/pitfalls.md`)

- Never delete files permanently, overwrite a file without a decision recorded beforehand, or delete a source before its copy is complete and verified.
- Never commit secrets, model weights, files over 50 MB, or anything from `C:\Users\stefa\.adperastra\` (signing keys). Never read that folder.
- Never add a library whose license is not on the allowed list (`plan/rules.md` R-LIC), or one that is not in `plan/libraries.md` (add it there first, section 5).
- Never write user-visible text in code. Every word comes from `src/i18n/locales/*.json` (then run `npm run i18n:pseudo`).
- Never call `invoke()` from a component. Only `src/services/*.ts` call Rust.
- Never add a Tauri command without adding it to `generate_handler!` and to the isolation allowlist (`npm run lint:ipc` checks this).
- Never use Tauri `Channel`; use the start/poll pattern or events (`plan/pitfalls.md` P-01).
- Never push to `main` directly, force-push, or rewrite history on `main`/`testing`.
- Never merge into `main` except through a pull request whose checks pass, and never with a Blocker or Major open (section 4C.5).
- Never publish a GitHub release without the owner's yes.

## 7. Talking to the owner

- Short and plain. Say what is done, what is next, and what you need.
- After each step, send one short message (section 4D) and keep working. Do not wait for a reply.
- When you stop, give the exact command or click path for anything the owner must do.
- Report numbers (speed, test counts) from what you ran, never from memory.

## 8. Plan updates

`plan/` in the repository is the only plan folder (`plan/STATUS.md` decisions log, 2026-10-30). Plan changes are made there directly, in their own `docs(plan)` commit.
