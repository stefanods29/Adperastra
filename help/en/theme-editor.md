# Theme editor

Create a local appearance and preview it before applying it.

## How to use

1. Open **Settings > Theme editor**.
2. Start from a built-in theme, change the listed colours and appearance options, then choose **Save theme**. The preview on the right uses your draft; the rest of the app keeps its current look until you save.
3. **Import theme** opens a preview; it does not apply immediately. Check the colours and choose **Save theme** when you want to keep it.
4. **Export theme** writes a `.adptheme` file. You can include the background image; the file never contains the original picture's folder path.

## Good to know

- Only safe data is imported. A theme stores colours, sizes, spacing and a choice of installed fonts. It cannot run CSS, scripts or programs.
- Installed fonts are referenced by name and are not included in exported themes. Adperastra never copies or redistributes font files.
- Unsupported materials use a solid fallback. Windows high contrast also keeps a solid surface.
- The **Custom style** section accepts only the listed corner and spacing properties. It does not accept arbitrary CSS.
- Colours that do not meet the contrast requirements are refused when you save. You can adjust the colour, or let the editor choose a readable one.
- Built-in themes are never overwritten. A saved custom theme is a separate local theme.

See also: "Day and night themes" and "Accent colours".
