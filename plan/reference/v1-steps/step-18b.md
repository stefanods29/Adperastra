# Step 18b: Advanced image editor: painting, filters, and project format (★★★★★)

**Needs:** 18a. **Builds:** brush engine.

## Tasks
- **Painting:** brush engine with size, hardness, opacity, flow, and spacing; eraser; fill and gradient; clone stamp; color picker; pressure support when a pen is used.
- **Adjustments and filters:** curves and levels, hue/saturation, color balance, blur and sharpen variants, noise reduction, and common artistic filters, as non-destructive adjustment layers where possible.
- **Text and shapes** as editable layers.
- **Rulers, guides, and zoom** controls.
- **Project format** that keeps layers, masks, adjustment layers, and text editable (an open, documented format; export to PNG, JPG, WebP, TIFF, and PDF; import PSD layers where ag-psd allows).
- Brush strokes within the Smooth tier (under 16 ms per frame).

## Parts to consider
PixiJS (MIT) or WebGL directly for the brush engine; ag-psd (MIT) for PSD import.

## Help pages
Painting tools; adjustments and filters; text and shapes; saving projects.

## Done when
I can paint smoothly with a pressure-sensitive pen (or mouse), apply curves and filters as adjustment layers, save a project, reopen it with everything still editable, and export a PNG.
