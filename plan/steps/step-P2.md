# Step P2: Adopt plan v2 (tools and plan files)

| | |
|---|---|
| State | ready |
| Difficulty | ★ |
| Branch | `chore/plan-v2` |
| Tag | none (no app change) |
| Depends on | 03b merged into `main` and tagged `v0.0.6-step03b` |

## Goal

The repository uses the new plan: precise step recipes, one check command (`.\scripts\gate.ps1`), a generated pseudo-locale, and a check that every Tauri command is registered, allowed and called with the right argument names. The app itself does not change.

## Do not do in this step

- Do not change any app code (`src/`, `src-tauri/src/`, `crates/`), except the exact lines that `cargo fmt` or `cargo clippy` point to in T4.
- Do not start Step 04a.

## Read first

- `plan/p2-files/AGENTS.md` (the new `AGENTS.md`), `plan/STATUS.md`, `plan/git-and-testing.md`.

## Decisions (already made)

- D1. The files this step brings in are kept in `plan/p2-files/`, because the plan folders were merged into `plan/` during Step 03b and deleted (`plan/STATUS.md` decisions log, 2026-10-30). T1 copies them into the repository, replacing files: `AGENTS.md`, `CLAUDE.md`, `opencode.json`, and `scripts/gate.ps1`, `scripts/check-ipc.mjs`, `scripts/check-i18n.mjs`, `scripts/make-pseudo.mjs`, `scripts/icu-lite.mjs`, `scripts/check-base.mjs`. `CLAUDE.md` is local only (`.git/info/exclude`) and is never committed.
- D2. That merge already removed the v1 step files that the plan folder did not ship (their texts are kept in `plan/reference/v1-steps/`) and replaced the misplaced folder `plan/design-sc/` with `plan/design/screens/`. Later guides are written into `plan/steps/` (`plan/EXPANDING.md`).
- D3. `pseudo.json` is generated from now on. Regenerating it changes all its strings once; that is expected.
- D4. `BLOCKED.md` is never committed (`.gitignore`).
- D5. `scripts/check-base.mjs` compares 17 files with the Git hashes in `plan/base.json`. If any differs, the recipes may not fit the code: the step stops before changing anything.

## Tasks

### T1 - Put the new plan on its own branch

First copy the agent files and scripts into the repository (D1). In the repository folder, run exactly:

```powershell
Copy-Item .\plan\p2-files\AGENTS.md, .\plan\p2-files\CLAUDE.md, .\plan\p2-files\opencode.json -Destination . -Force
robocopy .\plan\p2-files\scripts .\scripts /E /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
```

Check: `git status --short` shows `AGENTS.md` as changed.

Then run exactly:

```powershell
git stash push --include-untracked -m "plan v2 files"
git checkout testing
git pull
git checkout -b chore/plan-v2
git stash pop
```

If `git stash pop` reports a conflict, stop (golden rule 4).

**Base check.** The recipes of P2, 04a, 04b and 04c were written for the code at commit `11aced2` (the last Step 03b commit at that time). Run:

```powershell
node scripts/check-base.mjs
```

- If it prints `Base check passed (17 files match commit 11aced2).`, continue.
- If it prints `Base check FAILED`, the files it lists changed after the recipes were written, so some "find exactly" blocks may no longer match. Do not stop. Tell the owner the list in one line, then continue with P2, applying each change to the current file where the text has moved (`plan/pitfalls.md` P-29). Before starting each of 04a, 04b and 04c, check its recipe against the listed files the same way and correct it in its own `docs(plan)` commit (AGENTS.md golden rule 4).

**Files:** add to `.gitignore`, at the end:

```gitignore

# Agent stop notes (AGENTS.md rule 4), never committed
/BLOCKED.md
```

**Check:** `git status` lists the changed agent files and the new scripts.

**Commit:** stage only the plan and agent files in this commit (the scripts go in T2):

```powershell
git add AGENTS.md opencode.json plan .gitignore
git commit -m "docs(plan): adopt plan v2 with step recipes [P2/T1]"
```

### T2 - Gate, IPC check and generated pseudo-locale

**Files:**
- `package.json`: in `"scripts"`, replace the existing `"lint:i18n"` line and add two lines, so the block reads:
  ```json
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "lint:i18n": "node scripts/check-i18n.mjs",
    "lint:ipc": "node scripts/check-ipc.mjs",
    "i18n:pseudo": "node scripts/make-pseudo.mjs",
    "tokens": "node scripts/build-tokens.mjs"
  },
  ```
- Run `npm run i18n:pseudo` (rewrites `src/i18n/locales/pseudo.json`).

**Check:** `npm run lint:i18n` passes; `npm run lint:ipc` passes; `npm test` passes (the pseudo-locale test in `src/__tests__/i18n.test.ts` checks that plurals still format).

**Commit:**
```powershell
git add package.json scripts src/i18n/locales/pseudo.json
git commit -m "chore(tools): add the gate script, the IPC check and the generated pseudo-locale [P2/T2]"
```

### T3 - CI runs the same checks as the gate

**Files:** `.github/workflows/ci.yml`.

Find exactly:
```yaml
      - name: Set up Rust (stable)
        uses: dtolnay/rust-toolchain@stable
```
Replace with:
```yaml
      - name: Set up Rust (stable)
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
```

Find exactly:
```yaml
      - name: Check translations
        run: npm run lint:i18n
```
Replace with:
```yaml
      - name: Check translations
        run: npm run lint:i18n

      - name: Check Tauri commands
        run: npm run lint:ipc

      - name: Check Rust formatting
        run: cargo fmt --all -- --check

      - name: Rust lints
        run: cargo clippy --workspace --all-targets -- -D warnings
```

**Commit:** `ci: run the same checks as the local gate [P2/T3]`

### T4 - Make the gate pass

Run `.\scripts\gate.ps1`.

- If `cargo fmt` fails: run `cargo fmt --all`, check that only formatting changed (`git diff`), and commit `style: apply cargo fmt [P2/T4]`.
- If `cargo clippy` fails: fix only the exact lines it names, in the way its message suggests, without changing behavior. If a fix would change behavior, stop (golden rule 4). Commit `style: fix clippy warnings found by the gate [P2/T4]`.
- Run the gate again until it prints `GATE PASSED`. If nothing failed, there is no T4 commit.

### T5 - Contributor notes point to the gate

**Files:** `CONTRIBUTING.md`. Find exactly:

````markdown
Run the tests before you push:

```powershell
cargo test --workspace
npm test
npm run lint:i18n
```
````

Replace with:

````markdown
Run every check before you push (formatting, lints, Rust and UI tests, translations, Tauri commands, build):

```powershell
.\scripts\gate.ps1
```

After changing `src/i18n/locales/en.json`, run `npm run i18n:pseudo`.
````

**Commit:** `docs: point contributors to the gate script [P2/T5]`

### T6 - Finish

1. `git push -u origin chore/plan-v2`
2. Merge it into `testing` and `main` without waiting for the owner (AGENTS.md section 4D):
   ```powershell
   git checkout testing
   git pull
   git merge --no-ff chore/plan-v2 -m "merge: plan v2 into testing [P2]"
   .\scripts\gate.ps1
   git push
   gh pr create --base main --head testing --title "Plan v2: step recipes and the gate" --body "Adopts plan v2 (plan/STATUS.md). No app changes."
   gh pr checks --watch
   gh pr merge --merge
   git checkout main
   git pull
   git checkout testing
   git merge --ff-only main
   ```
3. In `plan/STATUS.md` (on `testing`): set P2 to `done`, "Current step" to `04a`, commit `docs(status): plan v2 adopted, next 04a [P2]`, push.
4. Remove `plan/p2-files/` (on `testing`), because its files are now in place:
   ```powershell
   git rm -r --quiet plan/p2-files
   git commit -m "docs(plan): remove plan/p2-files, its files are in place [P2]"
   git push
   Add-Type -AssemblyName Microsoft.VisualBasic
   [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory((Resolve-Path .\plan\p2-files).Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
   ```
5. Tell the owner in one line that plan v2 is on `main`, then start Step 04a.

## Done when

- [ ] `.\scripts\gate.ps1` prints `GATE PASSED` on `testing`.
- [ ] CI is green on the pull request.
- [ ] `plan/p2-files/` and `plan/design-sc/` no longer exist, and `plan/design/screens/` has 6 PNG files.
- [ ] `plan/STATUS.md` says the current step is 04a.
