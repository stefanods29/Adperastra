# Step 20a: Office editing: engine spikes and integration (★★★★★)

**Needs:** 13. **Builds:** Office engine adapter.

## Tasks
- **Throwaway spikes first** (not app code): test the candidate engines against my sample files and report fidelity (side-by-side screenshots against the PDFs exported from Microsoft Office), cold and warm open time against `speed.md`, memory, install size, license risk, and how well we can hide the engine's own toolbar and drive it from our own ribbon. Recommend an engine per format (Word-, Excel-, and PowerPoint-style may differ) and wait for my approval.
- **Engine candidates** (all LibreOffice technology, MPL-2.0 with some LGPL parts):
  - (A) Collabora Office desktop code in the Collabora Online repository (its Windows version runs a JavaScript UI in WebView2 over a local LibreOffice-based engine);
  - (B) ZetaOffice (LibreOffice compiled to WebAssembly, runs locally, scriptable via ZetaJS, can run without its own UI; an early-2025 report put it near 1 GB, so check its current size and license terms);
  - (C) LibreOfficeKit (native).
  - Not allowed: ONLYOFFICE and SuperDoc (AGPL).
- **Fallback ladder** if full in-tab editing proves infeasible: (1) accurate view + convert (already built), (2) basic editing with Univer's open-source core (Apache-2.0) and our own Office file reading/writing (lower fidelity; Univer's own Office import/export is a paid Pro feature and must not be used), (3) open in the user's chosen app.
- **Integrate the chosen engine** as part of the Office engine pack, behind an engine adapter: one warm engine shared by all Office tabs, memory limits and idle timeout, running in a helper process (`rules.md`, section 5).
- **Fidelity rules:** never silently drop content; preserve anything we don't understand when saving; warn me about unsupported features; saving goes through the version store; downloaded files stay read-only until "Enable editing". Automated round-trip tests (open, save, reopen, compare) over my sample corpus, run in the test suite.
- Always offer "Open in my chosen app" as a fallback.

## Help pages
How Office editing works; file compatibility and limits.

## Done when
I've approved an engine after the spikes; a document can be opened, edited through the adapter, saved, and reopened with round-trip tests passing.
