# Common instructions for per-step coding workers

Use one concrete prompt from [../prompts/README.md](../prompts/README.md). It names the complete guide, input contracts, task/file boundaries and return checklist. This file is not an assignment by itself.

Implement only the assigned step. The coordinator already wrote its guide. Read the whole guide and each consumed producer's data/Exports rows. Use its exact canonical paths, names, argument order, fields, enum variants, units, revisions, errors, bounds and lifetimes. Do not implement another step or invent a replacement interface.

Read source and plan files using file-reading tools. Write source, meaningful tests, bilingual help and an integration handoff. Do not execute compilers/tests/app/package managers/formatters/generators/downloads/API calls or install dependencies/change lockfiles. The owner explicitly reserves execution and integration for the coordinator, overriding AGENTS.md's sequential execution/commit duties for these workers.

Use an isolated writable checkout. Existing baseline files, provider declarations and shared integration files are coordinator-owned; read [OWNERSHIP.md](OWNERSHIP.md). Return exact proposed shared edits with path, containing symbol, change and reason. Missing provider code is not permission to duplicate jobs/cache/document/AI/Office registries or return fake success. Test doubles stay in tests.

Do not edit plan decisions, weaken tests, add unlisted dependencies or guess a missing name. For a contradiction cite both exact locations, report it and continue only independent tasks. Do not commit/merge/push/create PRs/tags/releases, read private signing-key storage or test on user files. Do not return credentials, model weights or generated binaries. Locale additions are English/Spanish proposals; coordinator generates pseudo-locale.

Return implementation files/patch, exact shared-file proposals, written test inventory and expected outcomes, dependency/asset requirements, imported/exported interfaces, lifetime/cleanup reasoning, unresolved gates and a list of checks not run. Never claim builds or tests passed without coordinator evidence.
