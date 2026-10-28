# Adperastra

Adperastra is a fast, free, open-source file explorer for Windows 11 that opens, converts, and edits your files in one window with browser-style tabs.

> Status: early development. Step 01b adds the app shell (tabs, themes, languages, settings, and help). Browsing folders arrives in Step 02.

## Build from source

You need: Git, Rust (stable), Node.js 22, and the Microsoft C++ Build Tools. The GitHub CLI (`gh`) is optional.

```powershell
npm install
npm run build
npx tauri build --no-bundle
```

Note for this PC: Windows security blocks Cargo under `Documents`, so build output goes to `%TEMP%\adperastra-target` (the scripts set `CARGO_TARGET_DIR` for you).

To run the setup launcher, package it first (the result is in `build\Adperastra`):

```powershell
.\scripts\package-setup.ps1
```

## Verify a download

Each release file has a `.sha256` file next to it on the release page. Check your download like this:

```powershell
Get-FileHash .\file.zip -Algorithm SHA256
```

Compare the result with the text in the `.sha256` file. They must match exactly.

## License and contributing

Adperastra is under the MIT license (see `LICENSE`). Want to help? See `CONTRIBUTING.md`.

The full build plan lives in `plan/` and `AGENTS.md`.
