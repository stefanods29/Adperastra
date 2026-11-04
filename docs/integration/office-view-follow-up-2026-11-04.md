# Office preview and application icon follow-up

The owner asked for continuous scrolling, keyboard page navigation, zoom,
original Office formatting, and the supplied horse photo as the app icon.

## Implemented locally

- The Word quick preview splits extracted text into pages. The reported Word
  file displayed five quick pages. These page breaks do not establish the
  original document's pagination.
- Document tabs use a bounded scrolling area and mount nearby pages. Each page
  retains its cache lease until it leaves the mounted range. Left/Right Arrow
  and Page Up/Down move through pages when the preview has focus.
- The viewer exposes zoom out, reset and zoom in controls. Zoom changes page
  width without reopening the Office source.
- The Windows icon is a square crop based on the supplied horse photo.
  Tauri generated `src-tauri/icons/icon.ico`, with a 128px PNG retained beside
  it for inspection.
- `office_accurate_source.rs` connects the verified Office read pool to the
  existing PDF helper for ordinary disk Writer documents. A render result is
  checked for its section, revision, size and page count. Its bounded PDF bytes
  are sent as an internal memory grant. The page renderer receives the existing
  job context for cancellation. The PDF session closes with its Office viewer.

## Remaining formatting work

This local build has no signed Office catalog or installed verified read pack.
The accurate path therefore remains unavailable. The extracted LibreOffice
runtime and compiled C++ bridge are provisioning evidence, with full app
confinement, source inventory, pack activation and corpus checks still pending.
The first accurate producer covers Writer documents. Spreadsheet and
presentation rendering need their section-specific integration. Warm retention
is disabled for this producer until expiry management is connected.

The quick preview still redraws text in a common font. It does not reproduce
the source's images, tables or typography. Office editing remains disabled
pending the Step 20a engine comparison and preservation requirements.

No private signing directory was accessed and no remote branch or release was
changed.

## Additional engine found

A prebuilt native LibreOfficeKit 0.1.3 distribution was installed outside the
repo and tested in Windows isolation. The owner's reported document produced
a 15-page PDF containing fonts and images. This is a candidate engine check,
with the [execution record](../office-engine/results/libreofficekit/0.1.3/preflight.md)
tracking the remaining app integration and activation requirements. The helper
uses a conversion CLI and does not implement Adperastra's `office_read_v1`
session protocol.

## Earlier verified preview build

The earlier `build/Adperastra/Adperastra-Preview.exe` SHA-256 was
`4d5e103cc24a85fd01439e9d1643829db2139011efffb3d13db90dc350262673`.
The embedded Windows icon was extracted from this executable and visually
checked against the horse source. The build script now watches the ICO so an
icon-only change rebuilds its Windows resource.

Live checks through Explorer and the document tab showed a 736px-high scroll
area. Right, Right, Left, Page Up moved from page 1 to 2, 3, 2 and 1. Zoom in
changed the displayed page from 957px at 100% to 1196px at 125%. Wheel scrolling
reached page 4 with three page images mounted. The reported source's hash was
unchanged. These checks cover the quick preview. The 15-page engine PDF has
not been connected to this tab.

The full gate passed. The native application suite reported 1,612 passed and
nine existing ignored tests. UI verification reported 2,233 passed tests in
401 files. Formatting, native lints, translations, command registration and
the frontend build also passed. No checks were weakened.

## Native Kit connector follow-up

The accurate source now accepts a signed `office_convert` producer when the
Writer read-session bridge is absent. It opens the resulting PDF in the same
07d helper used by PDF tabs, exposes every Writer page, and maps Impress pages
to structural slide sections only when their counts and indices agree. Calc
remains on its existing path. These are read-only views; they do not advertise
editing capability.

EngineHost recognizes the native `libreoffice-kit.exe` worker in root or
upstream `bin/` layout. It revalidates the complete signed resource inventory
before granting pack-tree access, uses fixed whole-document PDF arguments,
disables recalculation, bounds output to 64 MiB and refuses unsupported options.
Catalog trust and activation checks remain required. No unsigned installed
program is discovered or launched through the application.

The native worker also receives a private undisplayed Windows desktop with
only the AppContainer's required graphics rights. It receives no switch,
hook-control or ACL-modification rights. Other engine launchers are unchanged.
The desktop remains owned until the confined process/job are released.

A disposable probe included the application's actual `engine_security.rs`,
`engine_desktop.rs` and argument builder, rather than the earlier modified
launcher copy. The one-slide PPTX rendered in 1,829 ms. A new three-slide
fixture with bold/italic text, colored background, table and horse picture
rendered in 1,747 ms to a 39,260-byte PDF containing three page dictionaries.
The fixture source SHA-256 remained
`f0e508408afdb8aedc83928f966fbeb6aaf9fdaaf1201c173d63545eafcd4b94`.
Its PDF SHA-256 was
`def373a2b97069779d10b0b6b73c2a3b50e3a1683de2b7cbec11ab4d65982e1a`.
These probes still do not exercise an installed signed app pack or establish
reference fidelity and five-run cold/warm acceptance.

Five additional fresh-child/private-profile runs are recorded in
`docs/benchmarks/office-kit-native-cli-2026-11-04.json`: 1,985, 1,089, 1,118,
1,047 and 1,034 ms. Every result contained three pages and 39,260 bytes;
the fixture source hash was unchanged. Filesystem cache state was uncontrolled
and the workspace gate was compiling concurrently, so these are not a
qualified cold/warm engine-session benchmark.

The earlier Preview executable described above predates this connector.
Production pack redistribution review/signing/activation and the editing
binding remain unfinished. The conversion worker does not implement editing.
The separate LibreOfficeKit editing probe lost a custom XML relationship;
that failure still prevents a safe existing-document save claim.

The complete gate for the connector changes passed. The native app suite
reported 1,618 passed and nine existing ignored tests; pack-store's added
resource-inventory regression also passed. The UI suite reported 2,233 passed
tests across 401 files. Formatting, native lints, translations, command checks
and frontend build passed. An initial test-code Clippy finding was repaired
without suppressing the check, then the complete gate was rerun successfully.
Log: `%TEMP%/adperastra-office-connector-gate-20261104-pass2.log`.

After the gate, the updated debug preview was compiled and copied to
`build/Adperastra/Adperastra-Preview.exe` (113,456,640 bytes), SHA-256
`50e1b3095260a5a7b612fd2bf182784588deedcb7a08d55460eb976366483674`.
The optimized `Adperastra.exe` was not replaced. No signed Office pack was
activated, so the updated preview still falls back to structural pages in an
ordinary unprovisioned profile. No live accurate-tab or editor claim is made.

## Signed portable Office pack

The later local installation is in `build/Adperastra-Office-Layout`.
Launch `Adperastra-Layout.exe` from that folder so it finds its portable
profile and installed pack. The offline catalog signs 755 files, including
24 compatible font faces. The pack archive SHA-256 is
`eb4752286d8a6b8ab1ede1ad424a2f469497fffbc7ec9cf5da4f064fc23d9991`.
The private signing key was generated in memory for this local installation.
The portable debug executable pins its public key.

The first live Word attempt failed because Kit encoded a Windows verbatim
drive prefix as part of the file URL. An A/B test reproduced the failure
with the prefix and rendered the same file with a normal drive path. The
app converts the spelling only when constructing the Kit arguments, while
keeping the original pinned directory handles. Four argument tests passed.
The corrected app displayed Word, both workbook print pages and the formatted
PowerPoint slides, including the picture on slide 3. The workbook showed
its formatted date. The signed worker independently produced
one Word page, two workbook print pages and three PowerPoint pages without
changing any of the sample files.

## Standalone preview startup repair

The later layout-view change allows the verified one-shot renderer to serve
Calc as a continuous workbook print view. Impress keeps slide sections when
the PDF and structural indices match. Otherwise it serves the PDF in page
order, including legacy files without a slide index. These routes require
the signed `office.convert` capability. Structural comments are available
only where source section identities still match. The frontend identifies
the simplified preview when the verified renderer is unavailable.

At that stage the local pack root had no active Office pack, and the project release list
has no published pack. The installed native renderer remains a standalone
probe. End-to-end activation needs a reviewed Office archive and a catalog
signed for the public key already trusted by Adperastra.

The owner reported a localhost connection refusal. The last debug build above
was made without `tauri/custom-protocol`, so Tauri's context selected
`build.devUrl` even though `dist` existed. A successful frontend build and
native compile had not established standalone startup.

`scripts/package-preview.ps1` now builds the frontend, enables
`tauri/custom-protocol` in the debug application, and copies the result only
after both builds succeed. It refuses to replace a running preview. Keep
`build.devUrl` for normal development; standalone previews use embedded assets.

The replacement at `build/Adperastra/Adperastra-Preview.exe` has SHA-256
`a9dafd5074ce8e534a71e5c99564952d4dd38319ad7e38fef5a862c8753857ee`.
It was launched with a disposable data profile while port 5173 had no listener.
Native window inspection showed the Home screen and working Recent list,
with document URL `http://tauri.localhost/`, instead of the connection-refused
page. The optimized release executable was not replaced.

The owner also explicitly confirmed Excel spreadsheets are in the same Office
viewing, editing and safe-save scope as Word and PowerPoint. This startup fix
does not activate an Office pack or supply the missing editing binding.

The complete gate passed after this repair: native lints, workspace tests,
translations, command checks, UI tests and frontend build. The native app
suite again reported 1,618 passed and nine existing ignored tests; UI tests
reported 2,233 passed in 401 files. No check was weakened. Log:
`%TEMP%/adperastra-standalone-preview-gate-20261104.log`.
