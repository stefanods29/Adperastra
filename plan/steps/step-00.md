# Step 00: Plan, design inventory, contracts, and Git setup (★)

**Needs:** nothing. **Builds:** the repository, `ARCHITECTURE.md`, the Figma-to-step map. No app code yet.

## Tasks
- Read `AGENTS.md`, every file in `plan/`, and every step file once, so early steps never block later ones.
- Set up Git and the GitHub repository first (see `git-and-testing.md`); this step's documents are the first commits. Add the MIT `LICENSE` file.
- Open the Figma file (`design.md`) and deliver: the frame and component inventory, the frame-to-step table, the list of screens still to design, and the token-measurement plan.
- Propose, with a recommendation each:
  - the tech stack (compare Tauri 2, WinUI 3 + WebView2, Electron, Avalonia/Qt), confirming or challenging the Rust + Tauri decision;
  - the UI framework (React, Svelte, or Solid);
  - the architecture and every contract in `contracts.md` as `ARCHITECTURE.md` with interface sketches;
  - the folder structure of the repository (including `help/<lang>/`, `test-files/`, `docs/decisions/`, `docs/benchmarks/`);
  - the test plan and the speed measurement plan (`speed.md`), recording the development PC's specs in `docs/benchmarks/MACHINE.md`;
  - a dependency and license table with 2-3 options per component, all compatible with MIT.
- Confirm or adjust the step order and difficulty ratings, only for dependency or risk reasons.
- Ask me for sample files: .docx/.xlsx/.pptx (ideally with PDFs exported from Microsoft Office as reference), images, PDFs, videos, huge text files.
- List your assumptions and at most 5 blocking questions. Wait for my approval.

## Parts to consider
Tauri 2 (MIT/Apache-2.0) and its `window-vibrancy` crate (Mica/Acrylic); WinUI 3 / Windows App SDK (MIT) with WebView2; Electron (MIT); Avalonia (MIT); Qt 6 (LGPL). Reuse or study: Files (files-community/Files, MIT, C#/WinUI: tabs, dual-pane, tags, previews, shell context menu; check its speed). Study only, never copy code (incompatible licenses): Spacedrive (AGPL-3.0) and Explorer++ (GPL-3.0).

## Done when
I've approved the plan documents, the architecture, the stack, the dependency table, and the design inventory, and they're committed to the repository.
