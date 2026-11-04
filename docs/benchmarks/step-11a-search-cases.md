# Step 11a search and application speed cases

This file defines the cases and the evidence the coordinator must produce. It
contains **no measured values**. A benchmark JSON is accepted only when it
records the machine, the actual enabled capabilities and the raw runs.

## Machine record (fill from the run)

- Windows build, CPU, core count, RAM, system drive type and free space.
- App build (commit, release/debug, package or dev), data/profile root and
  whether the profile was fresh.
- Index state: root count, file count, content on/off, OCR on/off, USN helper
  off/on, database and WAL bytes, coverage (`complete` or `partial`).
- Foreground workload: Explorer tab open on the 100k folder or a different
  folder, CPU/disk load of other programs.

## Fixtures

`scripts/generate-search-fixtures.ps1` creates these under
`%TEMP%\adperastra-search-fixtures\run-<timestamp>` and never deletes a
user path:

| Fixture | Purpose |
|---|---|
| `100k\` (100 folders x 1,000 files, names with `report`, `port`, `alpha café`) | 100k-folder listing, first search page, filtering |
| `synthetic-1m.csv` (1,000,000 rows) | Synthetic index rows for the record-cap and page-size checks; the coordinator seeds a throwaway database |
| `alpha-cafe.txt` with `alpha café` | Diacritic name/content matching |
| `cached-ocr-beta.txt` with `beta` | Cached-OCR content path only when the OCR adapter is registered |
| `cases\` notes and a junction loop | Sparse/offline/permission/manual cases; the coordinator replaces notes with real attributes where the machine allows |
| `mock-usn.json` | Parser fixture: valid, bad-length, bad-offset and bad-version records |

PDF/OCR user fixtures from Step 07d/07e (3 pages, one scanned page, cached
"beta") are reused; this step does not create or modify a user's files.

## Cases

| ID | Tier | Runs | What is measured |
|---|---|---|---|
| `step11a.search.name.firstpage` | Instant < 100 ms | 7 | First 50-name page from the warm index, query `port`, median |
| `step11a.search.filter` | Instant < 100 ms | 7 | Typed filter (`ext = txt`, `size >= 1024`) first page, median |
| `step11a.search.content.firstpage` | Fast < 1 s | 7 | First content page for `alpha café`, median |
| `step11a.search.regex.scan` | job feedback | 3 | Time to first progress/cancel feedback for a bounded content regex; whole scan may continue as a job |
| `step11a.index.firstpaint` | Fast < 1 s | 7 | Time from starting a rebuild until the first result/status paint; indexing continues in the background |
| `step11a.index.100k` | background | 3 | Wall time for the 100k-folder scan to coverage complete, with peak DB+WAL bytes |
| `step11a.browse.100k` | same as Step 05/06 baseline | 7 | Folder open and tab switch while indexing, median |
| `step11a.startup.cold` | same as previous step + <= 20% | 7 | Cold start to usable Explorer with two indexed roots, median |
| `step11a.tab.switch` | same as previous step + <= 20% | 7 | Switch between two folder tabs, median |

## Rules

- Use 7 runs for Instant/Fast/regression cases; report every raw run and the
  median, not only the median.
- Compare against the latest previous-step JSON for the same machine and
  workload. A result more than 20% slower is a regression and must be fixed or
  logged as a Major with the reason.
- Coverage and truncation are explicit. A capped or truncated scan is never
  reported as "entire drive complete".
- A regex/content scan that exceeds the first-page budget must show progress
  and Cancel; the whole-scan duration is recorded separately from feedback.
- The JSON records the actual enabled capabilities only. An unavailable OCR,
  PDF or USN adapter is `unsupported`, not a fabricated success.
- Save the accepted result as `docs/benchmarks/step-11a-search.json` with the
  same fields; the coordinator owns the actual run and the report text.
