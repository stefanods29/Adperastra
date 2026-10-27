# Step 18a: Advanced image editor: layers and selections (★★★★★)

**Needs:** 14b. **Builds:** layered image documents.

## Tasks
- A GIMP-style mode of the image editor (an "Advanced" switch next to Edit and Draw), with a tool panel and its own ribbon, designed first in the Figma style.
- **Layers:** add, duplicate, delete, reorder, rename, show/hide, lock; opacity; blend modes; layer masks; merge and flatten; layer thumbnails in a Layers panel.
- **Selections:** rectangle, ellipse, lasso, polygon lasso, magic wand (tolerance), select by color; add, subtract, intersect; feather; invert; copy, cut, and paste selections as new layers; transform (move, scale, rotate) selections and layers.
- GPU-accelerated and tiled for large images (opening within the Fast tier; tools in the Instant and Smooth tiers); undo history panel; saving flattened images goes through the version store.

## Parts to consider
Fabric.js or Konva (MIT), PixiJS (MIT), miniPaint (MIT, reference), the `image` crate, libvips (LGPL, separate DLL). GIMP and Krita are GPL: study their ideas only.

## Help pages
Layers; selections; transforming layers and selections.

## Done when
I can combine three photos as layers with masks and blend modes, select parts with the lasso and magic wand, and export the result, with smooth interaction on a 24 MP image.
