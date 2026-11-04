# Erasing pixels

Choose **Erase** and set size, hardness and opacity. Brush over the pixels to remove; **Undo** restores a stroke. PNG and WebP can keep transparency. Formats without transparency use the chosen export background and show a warning. This tool removes pixels manually; it does not reconstruct an object or background.

## Good to know

- Erasing lowers alpha; it never writes the original file.
- A full-opacity stroke can make a pixel fully transparent.
- JPEG cannot keep transparency. The export dialog names its background before saving.
- Each finished stroke is one undoable change. A cancelled pointer gesture leaves no partial edit.

See also: "Drawing on images".
