# ADR 0003: Office engine stays a separate pack program

Status: proposed (Step 00, awaiting owner approval).

## Decision

Any LibreOffice-based engine (view 13, conversion 12b, editing 20a) ships as a separate, user-replaceable program inside an optional pack, driven through our engine adapter and our own ribbon; it is never linked into the Rust core.

## Why

LibreOffice is MPL-2.0 core with LGPL parts; rules allow LGPL only separate + notices + source links. LibreOfficeKit native linking would breach the gate and is rejected unless the spike (20a) shows a compliant separate-process shape. ZetaOffice only if its current terms are fully permissive; Collabora code only if its UI can be fully hidden behind our ribbon and strict CSP. ONLYOFFICE/SuperDoc (AGPL) never.

## Consequences

12a pack manager must handle large packs with resume + SHA-256; 20a spikes score license compliance as pass/fail; fallback (Univer open core + own OOXML) caps fidelity of 20b-22b and is recorded as such.
