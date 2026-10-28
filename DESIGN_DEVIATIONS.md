# Design deviations

Where the built UI cannot match the Figma design exactly, the closest option
is recorded here for owner approval (plan/design.md rule 6). Newest first.

## 2026-10-28 - Command bar, Details pane, menus and rename (Step 03a) - approved by the owner on 2026-10-28

- **What:** Figma shows the command bar only on the Home frame and has no Details toggle, Details pane, menus, or rename box (plan/design.md, "Screens still to design"). The owner approved a design preview before it was built, made from `plan/design-spec.md` tokens with the Windows 11 Explorer as functional reference: a Details toggle at the right end of the command bar (pressed state in the Explorer accent light), a 280 px Details pane with a 44 px file-type tile and a label/value list, menus 220-360 px wide with radius 8, the card shadow, 30 px items, 16 px icons, shortcuts at the right and an icon row (Cut, Copy, Rename, Share, Delete) on items, and a 22 px rename box with an accent border and a message bubble under it.
- **Closest-option differences:** the address row and the command bar now span the window above the navigation pane, as in the Figma frame (Step 02 kept the navigation pane full height); the folder's Pin button moved into See more (•••), as in Windows 11; the "?" help button sits at the end of the command bar; check marks use the accent color; "Show more options" shows Windows' own classic menu in its classic style (owner decision: it runs in a separate process for safety, so it can't use our tokens).
- **Evidence:** `docs/screenshots/step-03a/` - Home, a folder with the Details pane, item and empty-space menus (View submenu), several items selected, a refused rename, and the Sort menu, in English light, Spanish dark, and the pseudo-locale.

## 2026-10-28 - Explorer inside a folder and This PC (Step 02) - approved by the owner on 2026-10-28

- **What:** Figma has the Explorer Home page but not the Explorer inside a folder, the Details-pane variant, menus, or This PC (plan/design.md, "Screens still to design"). Those views were designed from `plan/design-spec.md` tokens and the Windows 11 Explorer as functional reference: 196 px nav pane, 34 px address box on the chrome surface, 28 px file rows, column widths following the Home frame (Name flexible, Date 190, Type 180, Size 110 right-aligned), folder view without a command bar (that arrives in Step 03a).
- **Closest-option differences:** the address bar carries small sibling-folder chevrons next to each segment (a Step 02 requirement with no Figma counterpart); a single Pin/Unpin button sits at the right of the folder view; drive cards on This PC are an extension of the Quick access card in the same tokens.
- **Evidence:** `docs/screenshots/step-02/` - Home, a folder, and This PC in English light, Home in Spanish light, dark variants from Slice 4.

## 2026-10-28 - File-type tiles instead of Windows shell icons (Step 02) - approved by the owner on 2026-10-28

- **What:** Step 02 asked for system icons; the owner chose the Figma file-type tiles for this step. Real Windows shell icons arrive in Step 07a for `.exe`, `.lnk`, and types without a tile, and Step 10a lets the user pick the icon style as part of icon packs (ADR 0005).

## 2026-10-28 - Derived dark theme (Step 01b) - approved by the owner on 2026-10-28

- **What:** The Figma design is light-only. The dark theme is derived from the same tokens (surfaces `#202020`-`#333`, Explorer accent lightened to `#4CC2FF` for contrast).
- **Evidence:** `docs/screenshots/step-01b/01-explorer-dark-en.png` and `04-settings-dark-es.png`; values live in `themes/dark.tokens.json`.

## 2026-10-28 - Custom title bar and Windows snap layouts (Step 01b) - custom title bar kept by owner decision; snap flyout awaiting visual confirmation

- **What:** The window uses a custom title bar (decorations off) with our tab bar inside; window buttons call the Windows API.
- **Decision:** The owner chose to keep the custom title bar and fix snap layouts instead of restoring the native frame (Step 01b report). The maximize button reports `HTMAXBUTTON` to Windows (verified by message test), so the Windows 11 snap-layouts flyout should appear on hover.
- **Still open:** The owner has not yet seen the flyout on their own PC (KI-005). If it does not appear, the fix happens in a later step; the native frame stays the last-resort fallback.

## 2026-10-27 - Setup window (Step 01a) - approved by the owner on 2026-10-27

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
