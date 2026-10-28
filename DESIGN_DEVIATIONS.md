# Design deviations

Where the built UI cannot match the Figma design exactly, the closest option
is recorded here for owner approval (plan/design.md rule 6). Newest first.

## 2026-10-27 - Setup window (Step 01a) - for owner approval

- **What:** The setup/repair window and the first-run window are not in the
  Figma file. They were designed from the measured tokens in
  `plan/design-spec.md` (white surface, `#E5E5E5` border, radius 10 window /
  4 controls, Inter font, Explorer accent `#0067C0`, 12-13 px text) and the
  owner approved the design as a text description before it was built.
- **Closest-option differences:** the launcher is a native egui window, so
  text rendering, the Windows title bar, and control shapes follow egui and
  Windows rather than the Figma frames pixel-for-pixel. Hover/pressed/
  disabled/focus states are egui's, tinted with the accent color; the full
  token-derived states arrive with the design-token engine in Step 01b.
  The dark variant is derived from the same tokens (dark surface `#202020`),
  since Figma is light-only.
- **Evidence:** `docs/screenshots/step-01a/` - repair with progress,
  offline/missing component, signature error, and the first-run window
  (language/theme and packs checklist), in English and Spanish, light and
  dark.
