# Adperastra 0.1.0 release artifacts

**Status: not generated. This table is completed only after the coordinator
builds and verifies the unsigned artifacts.** No hash, size, signature or
provenance value may be filled in by hand.

| Name | SHA-256 | Bytes | Source commit | Version | Target | Unsigned |
|---|---|---|---|---|---|---|
| Adperastra-0.1.0-windows-x64-setup.exe | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |
| Adperastra-0.1.0-windows-x64-portable.zip | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |
| SHA256SUMS.txt | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |
| THIRD_PARTY_LICENSES.txt | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |
| SOURCE-NOTICES.txt | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |
| release-notes-en.md | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |
| release-notes-es.md | pending | pending | pending | 0.1.0 | windows-x86_64 | yes |

The generated `release-manifest.json` records the six built files from
`installer/artifacts.json`; `SHA256SUMS.txt` is derived from those six and
cannot contain its own hash. `SHA256SUMS.txt` uses two spaces between the hash
and the file name. A release folder with any other file is refused by
`installer/check-release-artifacts.mjs`.

## How the values are produced

1. Build the app, NSIS installer and portable ZIP from the tagged commit.
2. Run `Adperastra.exe --release-tool write <release-dir> 0.1.0 <commit>`.
3. Run `Adperastra.exe --release-tool verify <release-dir>`.
4. Run `node installer/check-release-artifacts.mjs <release-dir> 0.1.0 <commit>`.

The helper hashes files and writes JSON and a checksum list. It reads no
signing key and adds no signature. If the workflow's attestation permission is
unavailable, the checksums remain the published origin evidence; no paid plan
is required.
