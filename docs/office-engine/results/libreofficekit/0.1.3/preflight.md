# Prebuilt Windows engine evaluation

2026-11-04. Installed `@deepseek-ai/libreoffice-kit` 0.1.3 and its matching
`@deepseek-ai/libreoffice-kit-win32-x64` package outside the repository under
`%LOCALAPPDATA%/Adperastra-provisioning/libreoffice-kit-0.1.3-2760c7f7334e4c1381238275aba47ca8`.
Installation used `--ignore-scripts --no-audit --no-fund` and exact versions.
The application dependency list was not changed.

The native package's 731 inventory files matched their SHA-256 entries,
totaling 190,778,606 bytes. Its engine executable SHA-256 is
`54bca4b4f597712734e3188dd9fc6d2725e4227eefb1060e698257c3f40560e6`.
The package source receipt pins LibreOffice 26.8.0.3 at
`bce0998afefdbc355585ca324285661a2170ba77`. It includes MPL-2.0 and MIT license
texts, source recipes, patches and a separate third-party notice inventory.
That inventory still needs a component-level redistribution review before
bundling with Adperastra.

## Executed checks

The coordinator's existing standalone Rust probe launched the package's native
helper using the project's 12b AppContainer and job boundary, with a private
Windows desktop, private writable scratch folder, read-only package access,
1 GiB job memory limit and a 60-second process timeout. It passed only fixed
conversion arguments. These probes do not use an installed Adperastra pack
lease and therefore do not qualify the production activation path.

- A disposable single-page DOCX converted successfully. The process exited 0
  in 2,773 ms and produced a 29,294-byte PDF.
- A read-only copy of the owner's reported DOCX converted successfully. The
  process exited 0 in 3,289 ms and produced a 267,759-byte PDF. Inspection with
  the existing `pdf-lib` dependency found 15 A4 pages, eight embedded image
  streams and eight font dictionaries. The helper reported no missing fonts.
  The original file hash was unchanged after the conversion. No source text
  or rendered owner content is retained in this report.

Timings are observations during concurrent development work. They do not
establish the five-run cold/warm benchmarks or performance acceptance. The
layout has not been compared with a reference exported by Microsoft Word.
Editing, preservation, sensitive input, external-resource tests, native
read-session protocol compatibility and app pack activation remain pending.

## Sources

Additional connector checks are recorded in
[the integration follow-up](../../../../integration/office-view-follow-up-2026-11-04.md).
They use the actual application launcher, its owned undisplayed desktop and
the fixed native argument builder. A formatted three-slide disposable PPTX
produced a three-page PDF without source modification. Five fresh-child runs
are retained in `docs/benchmarks/office-kit-native-cli-2026-11-04.json`.
They are not signed-pack/in-app or cold/warm acceptance evidence.

The already verified LibreOffice MSI also contains all 24 required regular,
bold, italic and bold-italic faces for Carlito, Caladea, Liberation Sans,
Liberation Serif, Liberation Mono and Noto Sans. They are in its sibling
`SourceDir/Fonts`, rather than `LibreOffice/share/fonts`. The pinned existing
`@pdf-lib/fontkit` dependency read their embedded name/license metadata;
[font-inventory.json](font-inventory.json) records versions, sizes and SHA-256
for 10,729,708 bytes. Metadata identifies Apache-2.0/OFL-1.1. No font was
installed globally, bundled into the app or added to an active pack. Complete
redistribution notices/source review and engine integration remain required.

An additional outside probe granted the container read-only access to those
font files and supplied each explicitly through the native worker's supported
`--font-file` argument. The three-slide fixture completed in 1,862 ms. A
read-only copy of the previously reported Word file completed in 3,239 ms,
producing the same 267,759-byte PDF with 15 page dictionaries; its original
hash remained unchanged. This font injection is still probe-only: it is not
implemented as a signed font-pack contract or global Windows font install.

## Spreadsheet scope follow-up

The owner explicitly included Excel alongside Word and PowerPoint. The same
isolated application-launcher probe rendered the existing disposable
`Sheet1900.xlsx` fixture with explicit compatible fonts in 2,857 ms. It exited
0 and produced a 20,013-byte PDF containing two page dictionaries. The source
SHA-256 remained
`3bd7f5606d5bdeb07495ae44dbd24dc7dab928385893a67ceeecfe8d7c8400e9`.
The fixture has Data/Audit sheets, a leading-zero string, a literal starting
with equals, a cached SUM result, a date and whole-number validation. This
probe establishes conversion success/page count/source preservation only;
displayed formula/date correctness, edit transactions and save round-tripping
were not verified. The application's accurate source still excludes Calc;
sheet-to-print-page mapping and grid/edit integration must be implemented
explicitly, rather than treating each PDF page as a worksheet.

The native worker's separate `render-images` operation was also tested using
the app's AppContainer launcher. It returned two visible worksheet parts,
their names (Data and Audit), and row/column geometry. Requesting a 240 × 100
tile from each part returned distinct, nonblank 96,000-byte buffers. The
worker completed in 782 ms including both requests, and the fixture SHA-256
was unchanged. The tile hashes were
`ab5f05c2ad1999e59d2027338f84ebcd8dcdac15931239a9bda2cbc7159ef0b5` and
`9285c9b849845f001de3ab497b41e263bae4a314341b934623fb3a15c22123a5`.
This supports a worksheet preview indexed by actual sheet parts, independent
of print pagination. It establishes neither interactive editing nor
spreadsheet format preservation after save.

- [Maintainer documentation](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/master/README.md)
- [Maintainer packaging details](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/master/docs/packaging.md)
- [Exact Windows package](https://registry.npmjs.org/@deepseek-ai/libreoffice-kit-win32-x64/0.1.3)

The current npm package's repository field names `deepseek-harness/libreoffice-kit`.
The public source examined was `deepseek-ai/dsh-libreoffice-kit`. Retain this
distinction when auditing provenance and source availability.
