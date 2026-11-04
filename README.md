# Adperastra

Adperastra is a free, open-source file explorer for **Windows 11 x64**, built with Rust, Tauri 2, React and TypeScript. Browse independent folder tabs, preview files and make supported edits in the same window.

**Current release: [0.1.0-preview.1 — Office preview](https://github.com/stefanods29/Adperastra/releases/tag/v0.1.0-preview.1).** This is an experimental portable release. Office editing has the limits below; it does not provide every feature of a full office suite.

## Download and run

1. Open the [release page](https://github.com/stefanods29/Adperastra/releases/tag/v0.1.0-preview.1).
2. Download **Adperastra-0.1.0-preview.1-windows-x64-portable.zip** and **SHA256SUMS.txt**.
3. [Verify the checksum](#verify-a-download), then extract the **entire ZIP** into a writable folder.
4. Run **Adperastra.exe** from the extracted folder. Keep the included files and `AdperastraData` folder together.

Windows 11, the Microsoft Edge WebView2 Runtime and the Microsoft Visual C++ x64 Redistributable are required. Windows commonly includes WebView2; if it is missing, install the runtime from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/). For the Office renderer, install or repair the [Microsoft Visual C++ x64 runtime](https://aka.ms/vs/17/release/vc_redist.x64.exe) if it is missing. These runtimes are commonly already installed; they are not bundled in this ZIP. The application executable has no Windows code-signing certificate.

The portable ZIP includes its signed Office renderer, compatible open-source fonts and license/source notices. **You do not need a separate LibreOffice installation for this ZIP.** GitHub's automatic “Source code” archives contain source, not the runnable app or renderer.

## Open two folders in separate tabs

- Click **+** in the tab bar. It immediately opens another **Home** tab.
- Open a folder there, then click **+** again to browse a second folder independently.
- Switch tabs to return to each folder. Each folder tab keeps its own browsing state and selection.
- The small arrow beside **+** opens additional tab options. Settings and Help are also available in the window toolbar.

Double-click a supported file to open its viewer tab. The original Explorer tab stays available while you work with files.

## Office files: preview, then edit

### Preview first

Open a `.docx`, `.xlsx` or `.pptx` file from a folder in Adperastra. It first opens in preview. With the included Office pack, the preview renders document pages, workbook print pages or presentation slides, including supported images and formatting.

Review the file, then choose **Enable editing**. A downloaded file may first show the protected-view acceptance flow. Opening a preview does not enable macros or document scripts.

### Documents (.docx)

1. Choose **Enable editing**.
2. Click editable text directly on the visible paper. A text field opens at that position.
3. Change the text, then press **Enter** or click **Apply**. **Escape** cancels the text change.
4. The page refreshes from the edited document, retaining its surrounding layout.

Scroll continuously through pages. Use the zoom buttons or bottom zoom control to enlarge the paper; **Fit** restores the fitted view.

### Presentations (.pptx)

Choose **Enable editing**, select a slide in the left panel and click editable text on the slide. Change it, then press **Enter** or **Apply**. The slide refreshes while retaining supported existing styling and pictures.

When the slide workspace has focus, **Left/Right Arrow** and **Page Up/Page Down** move between slides. Zoom works from the toolbar and bottom control.

### Spreadsheets (.xlsx)

Choose **Enable editing** to open the cell grid with row numbers, column headings, a formula bar and workbook tabs.

- Select an eligible cell and type, or edit its value in the formula bar.
- Use workbook tabs to switch sheets.
- Supported literal cells and eligible empty cells can be edited.
- Existing formulas are preserved. Formula entry, recalculation and full Excel display formatting are not available in this preview.

### Save your changes

Use **Save a copy…** or **Ctrl+S**, then choose a **new filename**. The copy keeps its Office extension. The original remains unchanged; replacing it is not available in this preview.

Undo and Redo work for supported edits. An unsaved indicator means changes are still in the live document. Reopening a saved copy loads its saved edits.

### Current Office limits

- Editing covers supported plain DOCX text runs, PPTX text and XLSX literal cells.
- Some repeated, ambiguous or unsupported text stays visible but cannot be selected for editing. Complex or oversized documents may have fewer editable targets.
- Changing fonts, paragraph formatting, page structure, images, shapes, charts or animations is not implemented by this editing engine.
- The spreadsheet grid has basic saved styling. Custom number/date display formats, merged geometry and original row/column dimensions are incomplete. Its print preview can differ from the editing grid.
- Older `.doc`, `.xls`, `.ppt` and OpenDocument files use the available preview route; this editor does not modify them.
- Rendering uses LibreOfficeKit and compatible fonts. Unavailable fonts or suite-specific features can cause differences from Microsoft Office. Exact pixel-for-pixel matching is not guaranteed.
- Initial opening and layout refresh can take time. Existing page images stay visible while a changed revision renders; stale text targets are disabled during that refresh.

## Other features

The explorer also includes viewers for common images, PDF, text, code, Markdown, media and archives, plus file operations and conversion tools. Availability varies by format and installed engine pack. Read the feature's Help page for its current limits.

**AI, speech and media engine packs are separate optional features.** This Office release contains no AI model or API key. A configured provider or additional engine may be required; an interface entry does not mean its runtime is installed.

Press **F1** or use **?** for help. The interface supports English and Spanish; change language and appearance in **Settings**.

## Portable data and updates

The included `portable-mode.marker` stores settings, sessions, cache and installed packs in **AdperastraData** beside the executable. Close the app before moving or backing up the entire portable folder.

Back up documents and saved copies separately. For this preview, extract an update into a new writable folder and retain the previous folder until you have checked it. Do not replace your existing data folder with another person's profile.

The published ZIP is built from a clean staging folder. It includes no developer settings, document history, credentials or personal documents.

## Verify a download

In PowerShell:

```powershell
Get-FileHash .\Adperastra-0.1.0-preview.1-windows-x64-portable.zip -Algorithm SHA256
```

Compare every character with the matching filename in `SHA256SUMS.txt` from the same [release](https://github.com/stefanods29/Adperastra/releases/tag/v0.1.0-preview.1). Do not run the download if the values differ. A checksum verifies downloaded bytes and is distinct from a Windows code-signing certificate.

## Build from source

Use the [released tag](https://github.com/stefanods29/Adperastra/tree/v0.1.0-preview.1) for the matching source. You need Rust, Node.js 22, npm, Microsoft C++ Build Tools and WebView2.

```powershell
git clone https://github.com/stefanods29/Adperastra.git
cd Adperastra
git checkout v0.1.0-preview.1
npm ci
npm run build
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP "adperastra-target"
cargo build --release -p adperastra-app --bin Adperastra --features tauri/custom-protocol --locked
```

The executable is at `$env:CARGO_TARGET_DIR\release\Adperastra.exe`. The `tauri/custom-protocol` feature embeds the frontend for standalone use. Normal development builds expect the development server.

The repository contains the public Office catalog verification key, not renderer binaries or a private signing key. Use the full published portable ZIP for the matching preinstalled Office pack. A freshly built executable by itself does not install that pack.

Run the project checks with:

```powershell
.\scripts\gate.ps1
```

See [plan/STATUS.md](plan/STATUS.md) for the implementation plan and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for limitations. Development guides can describe unfinished work; use this README and the release notes for download capabilities.

## Report problems and contribute

Open a [GitHub issue](https://github.com/stefanods29/Adperastra/issues) with your Windows version, release version, file extension and reproduction steps. A small synthetic example helps. Remove personal information before sharing documents, screenshots or logs.

See [CONTRIBUTING.md](CONTRIBUTING.md). Adperastra's own code is under [MIT](LICENSE). Dependencies, fonts and the Office renderer keep their own licenses; the download includes notices and source links. Third-party names describe file compatibility and do not imply endorsement.
