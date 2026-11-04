# Step 10f accessibility acceptance checklist (v0.2)

This checklist records evidence; it is not itself evidence. Every row stays
unchecked until the coordinator (or the owner, for the real-PC rows) has run
it and recorded the tool, version and result. A written unit test never
counts as a screen-reader pass.

## Automated checks (coordinator runs)

- [ ] `cargo fmt --all` clean; `.\scripts\gate.ps1` and `.\scripts\gate.ps1 -Package` pass.
- [ ] axe pass over Settings > Accessibility, Explorer, dialogs, menus and toasts: no critical violations.
- [ ] Locale key parity en/es for every `accessibility.*` and `errors.accessibility.*` / `errors.read_aloud.*` key; `npm run i18n:pseudo` regenerated.
- [ ] `npm run lint:ipc` passes with the new commands registered.
- [ ] Unit suites pass: accessibility, accessibilityUi, accessibilityAssets, readAloud, accessibleInput, plus the Rust cases in `accessibility_types.rs` and `read_aloud.rs`.

## Real assistive-technology flows (record tool + version per row)

- [ ] Narrator (record Windows build): browse a 10,000-item folder, move by keyboard, hear name/type/size/date and selection counts.
- [ ] NVDA (record NVDA version; a missing NVDA is not a pass): same folder flow.
- [ ] Keyboard only: open, rename-cancel, pick up + drop, read aloud start/pause/stop, dismiss a persistent toast.
- [ ] Narrator: Settings > Accessibility sections reachable and named; simple mode keeps Settings and help reachable.
- [ ] NVDA: transfer choice dialog names every action; Esc cancels with no change.

## Display and motion conditions

- [ ] 200% and 300% app zoom: Explorer, Settings, dialogs and menus lose no content; dialogs stay within viewport minus 16px and scroll internally.
- [ ] Windows forced colors: OS palette wins, decorative backgrounds/materials off, focus visible; turning it off restores the prior preferences.
- [ ] Windows reduced motion: no animation or autoplay; animated images show a poster frame.
- [ ] Subtitles at the strongest/weakest stored colors still meet 4.5 contrast or are refused by validation.

## Speed and screenshots (coordinator runs)

- [ ] `step10f.focus`, `step10f.zoom`, `step10f.simplemode` each Instant (<100 ms); read-aloud first chunk reported as Waiting (1-10 s) with Stop working; foreground browse unchanged. JSON under `docs/benchmarks/`.
- [ ] Screenshots 128-accessibility-settings, 129-high-contrast-300, 130-pick-and-read in English light, Spanish dark and pseudo-locale under `docs/screenshots/step-10f/`.

## Milestone v0.2 rows

- [ ] Every v0.2 capability (steps 07a-10f) traces to actual gate, speed, screenshot or AT evidence above; unproven rows stay open.
- [ ] No open Blocker or Major in `KNOWN_ISSUES.md` for anything 10f touches.
- [ ] Caption entry remains disabled with the pack reason until the 17b provider registers (this is correct behavior, not a failure).
- [ ] Release publication waits for the owner's yes. Nothing in this checklist publishes anything.
