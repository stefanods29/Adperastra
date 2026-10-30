# Step 10c: Accessibility (★★★)

**Needs:** 10b. **Builds:** accessibility settings (Settings > Accessibility). **Milestone:** v0.2 after this step.

Everything below is optional and can be combined. The app respects Windows accessibility settings automatically (text size, contrast themes, reduced animations, caret and focus settings), and these settings add to them.

## Tasks
- **Vision:** full screen-reader support (Narrator and NVDA: every control labeled, live regions for progress and toasts, meaningful reading order, file lists announced with name, type, size, and date); app-wide zoom up to 300% without breaking layouts; high-contrast themes and a contrast booster; thicker focus outlines and larger cursors inside the app; color-blind-friendly palettes (deuteranopia, protanopia, tritanopia) for accents, tags, and charts; information never shown by color alone (icons or labels too); a dyslexia-friendly font option with adjustable letter, word, and line spacing; "Read aloud" for documents and file names using Windows' built-in voices.
- **Hearing:** no information is given only by sound; optional sounds always have a visual equivalent (toast, flashing title bar or taskbar icon); subtitles in the media player with size, color, and background options; automatic captions for audio and video when the speech pack is installed (Step 17b).
- **Motor and dexterity:** everything reachable by keyboard; larger click targets option; adjustable double-click speed, hover delays (tab previews, drag-to-switch-tab delay), and drag distance; "click to pick up, click again to drop" as an alternative to dragging; works with Windows Sticky Keys; no actions that require holding keys or precise timing; toasts and confirmations never time out while hovered or focused; works with Windows Voice Access and on-screen keyboards (every control has a visible name it can be called by).
- **Cognitive and learning:** "Simple mode" that hides advanced features and shows a reduced menu and ribbon; plain-language messages; consistent placement of controls; optional confirmation before any action that changes files; an "Explain this" tip on complex features linking to its help page; progress always described in words, not only bars.
- **Seizures and motion sensitivity:** no flashing content; reduced or no animation (also follows Windows); autoplay of animated images and videos can be turned off.
- **Comfort:** optional subtle completion sounds (copy or conversion finished) with volume control; a "focus" layout that hides panels; no pop-ups that interrupt work.
- **Process:** from now on, each step's new screens are tested with Narrator and NVDA, keyboard only, 200% zoom, and a high-contrast theme, with results in the step report.

## Parts to consider
Windows UI and accessibility settings APIs; Windows `SpeechSynthesizer` for read aloud; OpenDyslexic (SIL OFL) for the dyslexia-friendly font.

## Help pages
Accessibility overview, plus one page per group (vision, hearing, motor, cognitive, motion).

## Done when
I can use the main flows with only the keyboard, with Narrator, at 200% zoom, and in high contrast; Simple mode works; color-blind palettes and read aloud work. I approve and v0.2 is released through the Step 08c pipeline.
