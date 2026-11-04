# Release process for 0.1.0

**Status: prepared locally; nothing is published by this document.** The
owner's standing instruction keeps work local: no push, pull request, tag on
`main`, GitHub release or other publication without a new explicit yes.

## Inputs

| Item | Value |
|---|---|
| Version | `0.1.0` |
| Tag | `v0.1.0` (created only after the merge gate passes) |
| Target | `windows-x86_64` |
| Node.js | `22.19.0` exactly |
| Rust | `1.99.0` exactly, with `rustfmt` and `clippy` |
| Tauri CLI | `@tauri-apps/cli` `2.12.4` exactly, pinned in `scripts/package-release.ps1` |
| Signing | none; public artifacts stay unsigned |

All version sources must agree before a build: `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`, `package.json` and the tag.
`Adperastra.exe --release-tool versions <repo-root> 0.1.0` checks the three
manifest sources. The release workflow separately checks that the tag and the
commit agree. A mismatch stops the build; a matching `0.1.0` string is not
accepted as proof on its own.

`dependencies.json` is the signed setup manifest. Its `app.version` is a
setup-package field, not the public release version; do not edit it or
re-sign it for this release without a separate owner decision. The generated
release manifest records the public version instead.

## Workflow

No workflow file is committed by this integration. A release workflow is an
owner gate: the coordinator adds `.github/workflows/release.yml` only after
the owner authorizes remote work. Its required contract is:

1. `on` is only `workflow_dispatch`, with required `tag` and `commit` inputs
   and an optional `attest` boolean. A tag push alone never starts it.
2. `tag` must match `vX.Y.Z` without leading zeros. `commit` must be a full
   40-character lowercase SHA.
3. The job checks out the exact commit with `fetch-depth: 0`, verifies that it
   is an ancestor of `origin/main`, and verifies that `refs/tags/<tag>`
   exists and points to that commit.
4. Toolchains are installed at the exact versions above. Dependencies come
   from `Cargo.lock` and `package-lock.json`; no release step weakens a check.
5. The full gate runs: `scripts/gate.ps1` (formatting, clippy, Rust tests,
   translations, IPC allowlist, UI tests, UI build).
6. The unsigned package script builds the NSIS installer and portable ZIP.
   It must not call `package-setup.ps1`, which uses a development signing key.
7. The package script writes the manifest and checksums. The workflow then
   re-runs `Adperastra.exe --release-tool verify` and
   `node installer/check-release-artifacts.mjs` to check names, hashes, sizes,
   checksums and the absence of debug, key, model and test files.
8. Artifacts are uploaded with `actions/upload-artifact`, pinned to the
   verified commit SHA. There is no publish, release, tag or deployment job.
9. Provenance is optional. When the owner's GitHub plan includes free
   attestations and `attest` is true, a separate job with only `id-token:
   write` and `attestations: write` attests the uploaded artifacts. When the
   plan does not include it, record "attestation unavailable" and keep the
   checksums; never purchase a plan for it.

### Pinned action commits (verified 2026-11-01)

| Action | Commit |
|---|---|
| `actions/checkout` v4 | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-artifact` v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/attest-build-provenance` v2 | `e8998f949152b193b063cb0ec769d69d929409be` |

Use the full SHA with a version comment. Rust is installed with `rustup
toolchain install 1.99.0` so no unpinned third-party toolchain action is
needed. Do not add cache actions that are not pinned.

## Package script

`scripts/package-release.ps1` is wired and does exactly this:

1. Require a clean working tree, `HEAD` equal to the requested commit, and the
   draft notes/source notices for the requested version under
   `docs/releases/<version>`.
2. Set `CARGO_TARGET_DIR` to a temporary folder as the other scripts do.
3. Run the pinned Tauri CLI build (its before-build step runs `npm run build`)
   with the NSIS bundle active. No signing certificate or key path is read;
   inherited signing variables are removed.
4. Reject a signed NSIS output and rename it to
   `Adperastra-<version>-windows-x64-setup.exe`.
5. Create the portable folder with `Adperastra.exe`, `help`, `templates`,
   `LICENSE`, `THIRD_PARTY_LICENSES.txt`, `SOURCE-NOTICES.txt`,
   `README.txt` and `portable-mode.marker`; compress it as
   `Adperastra-<version>-windows-x64-portable.zip`.
6. Copy `release-notes-en.md`, `release-notes-es.md`,
   `THIRD_PARTY_LICENSES.txt` and `SOURCE-NOTICES.txt` into the release
   folder, then run `Adperastra.exe --release-tool write <dir> <version>
   <commit>`.
7. Run `--release-tool verify` and
   `node installer/check-release-artifacts.mjs`, leaving the folder ready for
   upload but unpublished. The `release/` output folder is ignored by Git.

Local invocation:

```powershell
npm run release:package -- -Version 0.1.0 -Commit <40-hex-sha> -OutDir release
```

## Release notes

Release notes come from observed behavior and `CHANGELOG.md`, never from an
unbuilt guide. Before publication the coordinator:

1. Runs the acceptance matrix in `acceptance.md`.
2. Replaces every "planned" line in `release-notes-en.md` and
   `release-notes-es.md` with a verified statement, or removes it.
3. Keeps every open Blocker/Major visible until it is fixed; never marks a
   pending item as passed.
4. Confirms both language files and the four help pages exist and contain no
   untranslated text.

## Publication checkpoint

Publication is an **OWNER CHECKPOINT**. After the verified artifacts, notes,
checksums and readiness report exist, ask the owner plainly. Until the owner
answers yes, keep the folder clearly labelled unpublished and do not create a
GitHub release, tag on `main`, or any other remote publication.
