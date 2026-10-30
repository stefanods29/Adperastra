# Speed

The user should never wait long enough to feel bored or annoyed. We use the standard response-time limits (Nielsen: 0.1 s feels instant, 1 s keeps the flow, 10 s is the limit of attention) and Google's RAIL model (respond within 100 ms, 16 ms per frame, main-thread work in chunks under 50 ms).

## Tiers

| Tier | Limit | Examples | The user must see |
|---|---|---|---|
| Instant | 0.1 s | clicks, selection, menus, tab switching, typing, hover, search results while typing, toasts | the result |
| Smooth | 16 ms per frame | scrolling, dragging, resizing, zooming, animations (video: 30 fps minimum) | no stutter |
| Fast | 1 s | app start, opening a folder (first rows), opening a file (first view), quick preview, thumbnails appearing, switching layouts or themes | a skeleton within 0.1 s, then the content |
| Waiting with feedback | 1-10 s | opening a very large file completely, converting one small file, OCR of a large page, unlocking a locked folder | skeleton at once; after 1 s, words saying what is happening and progress; Cancel |
| Background job | over 10 s | copying many files, batch conversion, scans, indexing | job panel with progress, time left, Cancel; the app stays usable |

Background work never pushes foreground actions out of their tier: heavy work runs in Rust threads or helper processes at low priority; the UI thread never runs a task longer than 50 ms.

## How to stay fast (rules for every handler and view)

1. View first, edit later: show a fast first view, then load the editor behind it.
2. Never read a whole file to show the first screen: read ranges, stream, virtualize. Text files over 10 MB open read-only and paged.
3. Bytes travel through the `adpfile` protocol, not JSON (`plan/pitfalls.md` P-10).
4. Cache expensive results (thumbnails, first-page renders, metadata, OCR) keyed by path + size + modified time + handler version (Step 07a).
5. Cancel obsolete work: switching tabs or files cancels what the old one started.
6. Lazy-load every handler's code (`React.lazy`), so the startup bundle stays small.
7. Large lists are virtualized (`@tanstack/react-virtual`).

## Measuring

Measure on the development PC (`docs/benchmarks/MACHINE.md`) with the packaged release build (`.\scripts\gate.ps1 -Package`).

| What | Command | Output |
|---|---|---|
| Interactions inside the app | `.\scripts\measure-ui.ps1 -Out docs\benchmarks\<date>-ui-step<id>.json` | median of 7 runs per interaction |
| App start | `.\scripts\measure-startup.ps1 -Step <id>` | first paint and ready, 5 runs |
| Opening a 100,000-item folder | `.\scripts\measure-folder-open.ps1` | first rows painted |
| Opening files (from Step 04c) | `.\scripts\measure-ui.ps1` includes "open <type>" rows | first view per file type |

Adding a measurement: in `scripts/measure-ui.mjs`, inside `if (mode === "full")`, add `results.push(await measure("<name>", "<setup js>", "<action js>", "<cleanup js>"))`. The action must start the interaction; `measure` stops the clock at the next painted frame. For "first view" measurements use `window.__m.timeUntil(action, doneCheck)` as the existing "details pane filled in" measurement does.

Every step report has a table: interaction, tier, measured median, pass/fail. A result slower than its tier, or more than 20% slower than the previous step's JSON for the same interaction, is a known issue (Major for daily actions, `plan/rules.md` R-KI).
