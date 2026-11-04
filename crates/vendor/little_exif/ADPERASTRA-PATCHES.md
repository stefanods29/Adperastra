# Adperastra security compatibility patch

Source: crates.io `little_exif` 0.6.23, retaining its MIT/Apache-2.0 licenses,
copyrights and original manifest (`Cargo.toml.orig`).

The normalized build manifest uses quick-xml 0.42.0 instead of 0.37.5 to
remove RUSTSEC-2026-0194 and RUSTSEC-2026-0195. `src/xmp.rs` adapts the five
UTF-8 name/text/attribute accesses to the patched reader's string API. It
preserves the same EXIF removal and other-XMP retention behavior. The original
parser implementation is otherwise retained. Root workspace checks and the
image-conversion/privacy tests exercise the patched dependency.

No warning suppressions, parser-check opt-outs or advisory ignores were added.
