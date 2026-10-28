# ADR 0004: Manifest signing - development key now, release key in Step 08c

Status: accepted (Step 01a, owner request).

## Decision

`dependencies.json` is signed with **minisign** (Ed25519). The launcher has
the public key built in (`DEVELOPMENT_PUBLIC_KEY` in
`crates/setup-core/src/signing.rs`) and refuses to start from a manifest
whose signature is missing or does not match: it logs the reason, shows a
clear window ("This copy of Adperastra cannot be verified") with a Repair
re-check, and exits with code 4 in headless mode.

- **Development key (now):** generated once with
  `manifest-tool keygen`. The private key lives outside the repository at
  `%USERPROFILE%\.adperastra\dev-signing.key`; `.gitignore` blocks `*.key`
  and `*.minisig*` everywhere. Tools that sign (root manifest during
  development, the build-folder manifest in `scripts/package-setup.ps1`)
  read it from there or from `$env:ADPERASTRA_SIGNING_KEY`.
- **Release key (Step 08c):** a separate key pair is generated for releases.
  The private key is stored only as a GitHub Actions secret
  (`ADPERASTRA_SIGNING_SECRET_KEY`); the release workflow injects the
  matching public key into the launcher build and signs the shipped
  manifest. The development key is never used for a public release, and
  rotating keys only means changing the built-in public key.

## Plain-language note

This key is **free** and made by us. It is not a paid code-signing
certificate and has nothing to do with Windows SmartScreen. Its only job:
prove the component list inside the app folder is the one we published, so
a tampered or corrupted `dependencies.json` is refused instead of trusted.
