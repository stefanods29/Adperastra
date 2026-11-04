# Step <id> report - <step name>

Dates: <start> to <end>. Status: on `main` as `<tag>`; the owner's checks are still to do.

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

<Copy the "Check by hand" list from the step file, as numbered steps the owner can follow in the app.>

## What works

- <one line per finished feature>

## Not in this step (on purpose)

- <features the step file says come later>

## Decisions and plan changes made during the step

- <what was decided or changed in the plan, why, and where it is written> or "none".

## Speed (development PC, packaged release build)

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| <from the step file's speed table> | <tier> | <ms> | Pass/Fail |

Raw numbers: `docs/benchmarks/<file>.json`.

## Checks by hand

The owner fills this table (or tells you the results in chat and you copy them). Until then, every Result is "waiting for the owner".

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| <from the step file> | <ok/problem> | <ok/problem> | Pass/Fail |

## Verification

- `.\scripts\gate.ps1 -Package`: passed (<N> Rust tests, <N> UI tests, <N> translation keys).
- New tests: <list of new test names>.

## Screenshots

`docs/screenshots/step-<id>/`: <list>. Compared with `plan/design/screens/<frame>.png`: <differences, or "matches">.

## Known issues

- New: <KI-n (severity) title> or "none".
- Fixed: <KI-n> or "none".
- Still open: <list>.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: <new entries or "none">.
- New dependencies: <name version (license)> or "none".

## Commits

<output of: git log --oneline testing..HEAD>

## Next step

Step <next id>: <name> (from `plan/STATUS.md`).
