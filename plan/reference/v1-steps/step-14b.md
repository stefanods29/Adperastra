# Step 14b: Basic image editor (★★★★)

**Needs:** 07a, 06b. **Builds:** image edit mode. **Figma frames:** File Explorer · PNG abierto and PNG abierto · Dibujo. **Design:** Draw mode panels aren't designed yet; design them first.

## Tasks
- **Top row** (as in Figma): Undo, Redo, Compare (before/after), the "Edit | Draw" mode switch, zoom, and at the right Export ▾, Save a copy ▾, and Save (in the image accent color).
- **Edit mode:** the left tool rail and the right properties panel from Figma:
  - **Crop:** aspect presets (Free, Original, 1:1, 16:9, 4:3, 3:2), rotate left/right, flip, angle slider, crop overlay with rule-of-thirds lines and a size label.
  - **Size:** resize in pixels or percentage, with locked proportions (AI upscaling is added here in Step 14c).
  - **Adjust:** brightness, contrast, saturation, warmth, sharpness, blur.
  - **Filters:** presets (Original, Vivid, Warm, Cool, B/W, Sepia) with live thumbnails.
  - **Markup:** arrows, shapes, text, and highlights over the image.
  - **Erase:** an eraser brush that removes parts of the image (to transparency for PNG/WebP, or to a chosen background color for formats without transparency), with size, hardness, and opacity. If the AI image pack is installed, the panel also offers "Erase object" (Step 17b).
- **Draw mode:** brush, pen, highlighter, eraser, shapes, arrows, and text, with color and size pickers.
- Undo/redo history; saving goes through the version store; export with format and quality options (metadata kept by default); editing loads behind the viewer and is ready within the Fast tier; heavy operations run off the UI thread.

## Parts to consider
Fabric.js or Konva (MIT); PixiJS (MIT) for GPU-accelerated filters; Filerobot Image Editor (MIT) for crop/rotate/filter ideas or reuse; the `image` crate; miniPaint (MIT) as a reference.

## Help pages
Editing images; cropping and resizing; adjustments and filters; markup; erasing; drawing.

## Done when
I can crop, resize, adjust, filter, erase part of an image to transparency, mark it up, draw on it, compare before/after, and save; yesterday's version is in version history.
