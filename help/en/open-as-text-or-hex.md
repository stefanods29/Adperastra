# Open as text or hex

Any file can be shown as text, or as its bytes, whatever its type. This helps to see the source of a web page, read a settings file that has no extension, or look inside a file that no app opens.

## How to use it

- Right-click one or more files > **Open as** > **Open as text**: the file opens in the text viewer, with search and encodings (see "Viewing text and code").
- Right-click > **Open as** > **Open as hex**: the file opens in the hex viewer. Each row shows the position in the file (in hexadecimal), 16 bytes in hexadecimal, and the same bytes as text; a byte that is not a letter, digit or symbol shows as a dot.
- In the hex viewer, **Ctrl++**, **Ctrl+-** and **Ctrl+0** change the text size. Files bigger than 1 MB show in parts of 1 MB: use **Next part** and **Previous part** (**Alt+Page Down** and **Alt+Page Up**).
- In the hex viewer, press **Ctrl+F** and type what to find, then **Enter** or **F3**. The ribbon chooses **Search as text** or **Search as bytes** (for example 4D 5A). The search covers the whole file, whatever part is showing.
- **Ctrl+G** goes to an offset. Type it in hexadecimal (1F or 0x1F), or in decimal with # (#31).

## Good to know

- Both viewers are read-only: the file never changes.
- A file can be open in its usual viewer and as text or hex at the same time, in separate tabs.

See also: "Viewing text and code" and "Opening files in tabs".
