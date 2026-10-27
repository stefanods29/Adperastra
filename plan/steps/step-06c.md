# Step 06c: Archives, tables, and data viewers (★★)

**Needs:** 04b. **Builds:** archive service.

## Tasks
- **Archives** (zip, 7z, tar and its compressed variants; rar read-only where a library allows): browse like folders, preview files inside without extracting, extract all or a selection; Compress (zip, 7z) and Extract in the right-click menu and command bar, with progress and Cancel through the job runner. Protection against zip bombs (size and ratio limits) and path tricks (entries with `..` or absolute paths).
- **Password-protected archives:** create zip (AES-256) and 7z (AES-256, optionally encrypting file names) archives with a password from "Compress" (with a strength meter and show/hide), and open password-protected zip, 7z, and RAR archives (asking for the password, never storing it unless I choose to remember it for this session). Warn that old "ZipCrypto" zip encryption is weak and offer it only for compatibility.
- **CSV/TSV** as a sortable, virtualized table; **JSON** as a collapsible tree; **hex view** via the "Open as hex" command; **font preview** (basic; the full font previewer comes in Step 07c).

## Parts to consider
libarchive (BSD-2-Clause) and the `zip` crate (MIT) with AES support; `sevenz-rust` (Apache-2.0) or 7-Zip (LGPL with an unRAR restriction) only as a separate process; never bundle UnRAR code; TanStack Table (MIT).

## Help pages
Opening and creating archives; password-protected archives; viewing CSV and JSON.

## Done when
I can browse a zip without extracting it, create a password-protected 7z, extract it, open a CSV as a table, and a zip bomb from the malicious file set is refused safely.
