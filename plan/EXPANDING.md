# Writing guide steps (instructions for the planner)

Steps marked `outline` in `plan/STATUS.md` are not written yet. Before the coding agent can build one, a strong model (the **planner**, for example Claude Opus) writes its **guide**: a precise description of everything to build, with every decision made, but **no code**. The coding agent then writes the code exactly as the guide says. The coding agent never writes guides and never builds an `outline` step.

`plan/steps/step-05a.md` is the model guide: same sections, same level of detail. Read it whole before writing a guide.

The owner pastes the planner prompt from `plan/PROMPTS.md` to start a planner session.

## 1. Where things are

| What | Where |
|---|---|
| The repository (the app's code) | `C:\Users\stefa\Documents\Adperastra` |
| Plan folders (the owner's extracted plan zips) | `adperastra-plan-*` folders inside the repository folder. The newest one (now `adperastra-plan-v2.1`) is complete. Older ones (`adperastra-plan-v2`) are only kept for reference. They are never committed (`.git/info/exclude`, Step P2) |
| Where the planner writes | the newest plan folder: `adperastra-plan-v2.1\plan\steps\step-<id>.md` and the plan files listed in section 8. Never anything else. When the coding agent has the planner role too (AGENTS.md section 5, "A step without a guide"), it writes the guide and those plan files in the repository's `plan/` on the step's branch instead |
| How guides reach the repository | the owner tells the coding agent "apply the plan update from adperastra-plan-v2.1" (AGENTS.md section 8) |

The planner reads the repository but never changes it: no edits to app code, no commits, no branches. Never read, print or copy anything under `C:\Users\stefa\.adperastra\` (signing keys).

## 2. Order and timing

- Write the guides in the order of `plan/STATUS.md` (05b, 05c, 05d, 06a, ...), one step per guide, never skipping one: each guide builds on the names the earlier ones fixed.
- **Best accuracy:** write a step's guide after the previous step is merged into `testing`, reading the real code.
- **Writing ahead** (the previous steps are not built yet): base the guide on the earlier steps' recipes (04a to 04c contain the full code) and guides (the names they fix, collected in `plan/guide-ledger.md`). Say so in the guide's header table: `Written before | <first step not built yet> was built`. The coding agent then stops (golden rule 4) if a name the guide expects does not exist.
- Milestone steps (08d, 10f, 13, 16, 17d, 22b) also list what the release must include, from `plan/roadmap.md` "Milestones".

## 3. Read before writing a guide

1. `AGENTS.md`, `plan/STATUS.md`, `plan/rules.md`, `plan/conventions.md`, `plan/pitfalls.md`, `plan/contracts.md`, `plan/libraries.md`, `plan/speed.md`, `plan/glossary.md`, `plan/guide-ledger.md`.
2. The step's scope: its row in `plan/roadmap.md`, the table "Where the v1 plan's features went", and the v1 texts it maps to in `plan/reference/v1-steps/` (every feature given to this step must be in the guide, or in its "Do not do" list with the later step that takes it). For screens: `plan/design.md`, `plan/design-spec.md`, `plan/design/screens/`. For AI steps: `plan/ai.md`. Also `plan/backlog.md`.
3. The model guide `plan/steps/step-05a.md`, and the previous step's guide.
4. The code: every file the guide will change, read whole, at the state the step starts from (section 2). Note the exact names of the functions, types, props, CSS classes, translation keys, tests and help pages you will mention.
5. Libraries the step adds (from `plan/libraries.md`): confirm the exact version, its license (`plan/rules.md` R-LIC), the Rust version it needs, and that every function, type and feature flag the guide names exists in that version (docs.rs for crates, the package's type definitions for npm). Never name an API from memory.

## 4. What a guide contains (sections in this order)

1. Title `# Step <id>: <name>` and the header table: State `guide`, Difficulty, Branch, Tag (from `plan/STATUS.md`), Depends on, and `Written before` when it applies.
2. The note that this is a guide step (copy the paragraph under the header of step-05a).
3. **Goal**: what the owner can do after the step, in plain words.
4. **Do not do in this step**: related things that belong to other steps, each with the step that does it.
5. **Read first**: the plan files, pitfalls, recipes and code files the agent must read before T1.
6. **Decisions (already made)**: `D1`, `D2`... one or two sentences each, covering every choice that shapes the work (libraries, limits, behavior, layout, file formats, safety).
7. **Data shapes**: tables for every new type, struct, settings field (Rust type, TypeScript type, default, allowed values, validation, normalization), file format, Tauri command (arguments, returns, error codes), command (id, label key, icon, shortcut), and the full **translation key** table (key, English, Spanish).
8. **Tasks** `T1`, `T2`...: each with **Files** (create/modify, exact paths), **Do this** (numbered steps), the translation keys it adds, **Tests** (file; each test's name, steps or input, and expected result, as a table), **Traps** (what tends to go wrong), and **Commit** (the exact message, `<type>(<area>): <what> [step-<id>/T<n>]`).
9. **Help pages**: the full text of every new page in English and Spanish (`plan/recipes/add-help-page.md` format), and the exact changes to existing pages.
10. **Check by hand**: a table of the test files the agent creates (path, content; never a script), then numbered checks the owner does in the packaged app, including Spanish, the dark theme and keyboard use.
11. **Speed**: interaction, tier (`plan/speed.md`), measurement name (added in a task to `scripts/measure-ui.mjs`).
12. **Screenshots**: names (next numbers from the ledger), added in a task.
13. **Done when**: a checklist.

## 5. How precise (the coding agent decides nothing)

- **Names:** every file path, module, function, parameter and its type, return type, constant and its value, struct and field (with serde defaults), Tauri command (arguments, error codes `<area>.<reason>`), settings field (schema number, default, validation, migration), translation key (English and Spanish, Spanish from `plan/glossary.md`), CSS class, React component and prop, test file and test name, commit message.
- **Behavior:** every algorithm as numbered steps or a table, with formulas and every edge case: empty, missing, too long, too many, cancelled, failed, online-only files (R-FS-1), long paths, access denied, disappearing drives, a second click while working.
- **Components:** the element structure (elements, classes, roles, `aria-*`, `data-*`), what each handler does, the states (loading with a skeleton, empty, error, disabled), keyboard use, focus, and which translation keys each text uses.
- **Styles:** a table per selector with the layout, sizes and spacing (pixels or `--adp-space-*`), and look (only tokens such as `--adp-color-*`, `--adp-radius-*`, `--adp-font-*`), in words. Sizes come from `plan/design-spec.md`; when the design has none, decide them and say so.
- **Changes to existing files:** the file, where (name the function, element or setting; quote one existing line only to locate it), and what changes, in words. Say "do not change the `useMemo` dependencies" and similar where a careless edit would break things.
- **Tests:** every task that adds behavior adds tests: pure logic gets tables of inputs and expected outputs (work out the expected values by hand and double-check them); components get user-level tests (click, keys, what is shown). When the step changes behavior that an existing test checks, the guide names that test and gives its new assertions; it never says "delete" or "skip".
- **Order:** tasks are ordered so the gate passes after every task (types and tests that a change breaks are fixed in the same task). Usually 8 to 12 tasks. A new library is its own task (`plan/recipes/add-dependency.md`, `deps:` commit). Settings bumps follow `plan/recipes/add-settings-field.md` and the ledger's counter.
- **Limits:** new files stay under 400 lines (split them in the guide); at most about 40 new lines per task in `src-tauri/src/main.rs`, `src/views/ExplorerHome.tsx` and `src/App.tsx` (put logic in new modules and hooks).

## 6. No code

A guide gives decisions, not code. The coding agent writes all the code.

- **Never in a guide:** statements, function bodies, declarations written in a programming language, Rust attributes, JSX, CSS declarations, shell or PowerShell scripts, regular expressions written as code, JSON or TOML blocks to paste (a settings or file format is a table).
- **Allowed:** names and paths; a function's parameters and return type in a table; literal values (numbers, strings, ids, key names, error codes); formulas in plain math (`max(1, floor(width / 128))`); tables of test inputs and expected results; exact user-visible texts (translation keys, help pages in fenced `markdown` blocks); commit messages; the git commands that `AGENTS.md` already uses.

## 7. Rules every guide keeps

Data safety (`plan/rules.md` R-SAFE: Recycle Bin, never overwrite without a choice, temporary file then rename, version hook before changing a file, undo entries), security (R-SEC: `ensure_main` and argument checks in every command, allowlist, no `Channel`, untrusted markup only in sandboxed frames, size limits, risky parsers in a helper process, no network), file-system edge cases (R-FS), everything translated (R-LANG), feedback and design (R-UI: skeleton after 0.1 s, words after 1 s, jobs with Cancel over 10 s, tokens only, keyboard, help page per feature, dark theme), speed (R-SPEED), background work (R-BG), licenses (R-LIC), AI rules (R-AI, `plan/ai.md`). The owner's standing limits: no code-signing certificates, no OneDrive integration, no telemetry, offline first, never commit model weights, keys or files over 50 MB, the AI assistant never deletes permanently.

## 8. After writing a guide

1. In the plan folder: `plan/STATUS.md` (the step's state becomes `guide`) and `plan/roadmap.md` (same).
2. `plan/guide-ledger.md`: the counters (schema, tags, screenshot numbers), the names the guide fixes that later steps use, and new traps.
3. `plan/contracts.md` when the step builds or changes a contract; `plan/libraries.md` with the exact versions and features added; `plan/ui-kit.md` with new reusable components.
4. Check the guide against this list before calling it done:
   - every feature of the roadmap row and of the mapped v1 text is in the guide or in "Do not do" with its later step;
   - every file it names exists in the code (or is created by an earlier task of the guide);
   - every name is spelled the same everywhere in the guide and matches the ledger;
   - every translation key used is in the table, in both languages, with the same `{arguments}`;
   - every command's help page exists or is created;
   - every test's expected values were worked out by hand;
   - nothing in it is code (section 6);
   - the gate can pass after each task (types, tests and translations changed together).
5. Tell the owner: "The guide for step <id> is ready in adperastra-plan-v2.1. Tell the coding agent: apply the plan update from adperastra-plan-v2.1." Then continue with the next step if the owner asked for several.

## 9. Research method (how to investigate before writing)

The guides 05b to 06d were researched this way. A guide is only as good as its facts: a name that does not exist, a library function from memory or a forgotten edge case stops the coding agent (golden rule 4) or, worse, ships a bug. Spend most of the time here, before writing.

### 9.1 Know what the code looks like when the step starts

1. `git -C <repo> log --oneline -15`, `git branch -a`, `git tag`: which steps are really built. Steps marked `done` in `plan/STATUS.md` exist in the repository; everything after them exists only on paper.
2. For each file the guide will change, find its content at the step's start, in this order of trust: the repository (built steps); the "ready" recipes `plan/steps/step-P2.md`, `step-04a.md`, `step-04b.md`, `step-04c.md` (they contain the full code: search them for "Create `<path>`" and for the "find exactly" blocks that touch that file); then the guides from 05a on (search `plan/steps/*.md` for the file name and every symbol you will use) and `plan/guide-ledger.md`. A later guide may have renamed or changed what an earlier recipe wrote: always take the newest.
3. Quote names exactly: functions, props, CSS classes, translation keys, test names, help slugs, command ids, settings fields. Check the existing translation keys you reuse (`common.cancel`, `fileTab.openInWindowsApp`...) in `src/i18n/locales/en.json` or in the recipe that adds them.
4. Note every test that the change will break (literal objects of changed types, lists of ids, counts of handlers or sections) and write their new assertions into the guide (the ledger's traps list several).

### 9.2 Verify every library fact at the pinned version

1. Metadata from `https://crates.io/api/v1/crates/<name>` (and `/<name>/<version>`): the newest patch of the pinned minor, `license`, `rust_version`, the `features` map (including what each feature pulls in) and the dependency list with version requirements. For npm: the package's `package.json` at that version.
2. Every function, type, enum variant, field and feature gate you name: the docs.rs item page at the pinned version (`https://docs.rs/<crate>/<version>/<path>/struct.X.html`). Quote the exact signature. Summaries of long pages are often wrong (06b and 06d were told that functions were "missing" that exist): use the verbatim text.
3. When docs.rs has no page (the `windows` crate), read the local source in `C:\Users\<user>\.cargo\registry\src\index.crates.io-*\<crate>-<version>\` (search for `pub unsafe fn <Name>` and the `cfg(feature = ...)` line above it, which names the cargo feature that gates it). For npm packages, check `node_modules` (06d checked lucide icon names by loading the package with Node).
4. Default features: list what they bring. They can add a license outside R-LIC, a second version of a crate already in the tree, or a C build (bindgen needs libclang, which the dev PC may not have). Prefer `default-features = false` with an exact feature list, and pure-Rust crates already in the dependency tree.
5. The minimum Rust version of every crate against `rustc --version` on the dev PC; Node against `node --version`.
6. Licenses against `plan/rules.md` R-LIC-1. A license not on the list is the owner's decision: ask with 2 or 3 options and a recommendation, and keep writing around it (leave the feature for a later step) instead of waiting.
7. Record what you checked in `plan/libraries.md` (version, features, the functions checked), so the next planner does not repeat it.

### 9.3 Try things on the PC when you can

- Run small experiments in your own scratch folder, never in the repository (06d used Windows' own `tar.exe` to prove it can make zip, 7z, tar.gz and tar.xz test files).
- Check which programs are installed before planning around them (06d found that 7-Zip is not installed, one reason RAR moved to 06e). If a feature depends on a program the PC lacks, design tests that do not need it (parsers tested on fixed text) and say in "Check by hand" what the owner must install.

### 9.4 Think through behavior before writing

For every user action, write down: what happens on success; empty, missing, too many, too long; cancelled midway; failed midway (what is left on disk, what Undo can do); a second click while working; online-only files (R-FS-1); long paths and `\\?\` paths (P-11); reserved names; links and loops; slow or vanished drives; access denied; Spanish texts that are longer; the dark theme; keyboard only; screen readers. Then check the rules one by one: R-SAFE (Recycle Bin, partial file then rename, never overwrite, version hook, undo entry and toast), R-SEC (`ensure_main`, argument limits, allowlist, no `Channel`, untrusted markup only in sandboxed frames, risky parsers in a helper process, no command lines built from paths), R-UI (skeleton after 0.1 s, words after 1 s, jobs with Cancel over 10 s), P-10 (IPC answers under about 1 MB), P-28 (every effect cleans up). Decide each case and put it in the guide.

### 9.5 Work out every expected test value by hand

Write the arithmetic down while planning (for example 2 GiB / 1 MiB = 2048, so a ratio limit of 500 refuses it). Check dates (days since 1970), sizes, sort orders and limits twice. Never write "should work" in a test table: give the input and the exact result.

### 9.6 Check the guide mechanically after writing

- Every translation key the guide uses is in its table or already exists (a small script that collects the backticked keys and compares them with the table helps).
- Search the guide for code-like text (`=>`, `= {`, `fn `, `let `, `const `, semicolons at line ends, JSX tags) and rewrite it in words (section 6).
- Every file the guide names exists or is created by an earlier task; every command's help slug exists by the task that adds the command.
- Then the section 8 checklist.
