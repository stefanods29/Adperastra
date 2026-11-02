# Parallel coding packet: all 54 remaining steps

Owner direction, 2026-11-02: finish all guides, including AI, supply one prompt per step, review the packet, then stop. This packet does not dispatch workers or implement application features.

Start with [the prompt folder](../prompts/README.md). Give an AI one step prompt together with read access to this repository. Each prompt assigns one complete guide; the worker writes code and required tests without designing its own guide or guessing another step's functions. [GUIDE_STATUS.md](../GUIDE_STATUS.md) lists all 54 guides and their counter reservations. Writing a guide does not mean its feature is built or accepted.

## Working at the same time

Workers can write independent feature bodies against exact producer contracts before those producers are implemented. Read the guide's Uses and the producer's Exports/data tables, importing canonical types rather than copying them. [INTERFACES.md](INTERFACES.md) and [CONTRACT-INDEX.md](CONTRACT-INDEX.md) locate definitions. Missing provider code is not permission to invent a production stub.

Each worker needs a separate writable checkout or an isolated output folder. Only the coordinator changes shared files and integrates extensions to previous steps. [OWNERSHIP.md](OWNERSHIP.md) defines this boundary. Workers return precise proposed shared edits. Running all workers in one writable checkout is unsupported.

Workers write source, tests, bilingual help and integration instructions. They do not install dependencies, change lockfiles, compile, execute tests, format, generate files, launch the app, package, benchmark, download assets or call APIs. The coordinator performs these checks later against the integrated implementation and fixes failures. Written test expectations are not results.

## Handing out assignments

Choose one file from [prompts](../prompts/README.md), and give the worker read access to the application and all plan files. Application source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. This documentation packet adds future specifications, not their implementations. The coordinator prepares separate writable checkouts; a worker without one returns proposed file contents instead of changing a shared checkout.

[ASSIGNMENTS.md](ASSIGNMENTS.md) indexes all 54 per-step prompts. It replaces the old A–L stream briefs. No step is excluded:14c,17a–17d,20c,21b and the full AI/manual22b are included. Code writing overlaps; integration remains in roadmap order.

## Assistant options and implementation gates

The assistant offers Local AI and API key modes. Local is initial; Meta Model API is first among API providers.17a specifies native credentials, exact outbound-payload review and one-use consent. File access is not upload permission. No automatic cloud fallback. Speech, image models and embeddings remain local. [AI-API-EVIDENCE.md](AI-API-EVIDENCE.md) records researched protocols and versions.

The guides retain real evidence gates: object-bound Replace/recycle must be proved;20a needs an editing-engine comparison/owner checkpoint;16 needs a Windows identity/distribution decision; production packs need actual built-artifact hashes/signatures/license/security evidence. These facts are not fabricated. Credentials and paid API calls are user choices later.

[REVIEW.md](REVIEW.md) describes future implementation acceptance. [FINAL-REVIEW.md](FINAL-REVIEW.md) records this documentation review and current-baseline checks. This delivery stops at guides and prompts.
