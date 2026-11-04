import "./styles/convert.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerLockedDocumentProvider } from "./documents/LockedDocumentProvider";
import { registerOfficeEditorControllers } from "./office/officeHost";
import { registerAiSearchRegistrations } from "./search/ai/aiSearchSchemas";
import "./i18n";
import "./styles/tokens.css";
import "./styles/appearance.css";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/thumbnails.css";
import "./styles/preview.css";
import "./styles/metadata.css";
import "./styles/views.css";
import "./styles/columns.css";
import "./styles/filetabs.css";
import "./styles/ribbon.css";
import "./styles/viewers.css";
import "./styles/media.css";
import "./styles/hex.css";
import "./styles/settings.css";
import "./styles/layout.css";
import "./styles/versions.css";
import "./styles/archive.css";
import "./styles/archive-create.css";
import "./styles/templates.css";
import "./styles/table-view.css";
import "./styles/font-view.css";
import "./styles/json-view.css";
import "./styles/gallery.css";
import "./styles/pdf.css";
import "./styles/ocr.css";
import "./styles/book.css";
import "./styles/notebook.css";
import "./styles/email.css";
import "./styles/subtitle.css";
import "./styles/log.css";
import "./styles/sqlite.css";
import "./styles/model.css";
import "./styles/specialImage.css";
import "./styles/psd.css";
import "./styles/accessibility.css";
import "./styles/ai-actions.css";
import "./styles/ai-extraction.css";
import "./styles/ai-inline.css";
import "./styles/ai-search.css";
import "./styles/ai-upscale.css";
import "./styles/app-storage.css";
import "./styles/assistant.css";
import "./styles/bulkRename.css";
import "./styles/clipboardHistory.css";
import "./styles/conversion-presets.css";
import "./styles/deck-ai.css";
import "./styles/deck-style-library.css";
import "./styles/diagnostics.css";
import "./styles/document-ai.css";
import "./styles/effects.css";
import "./styles/fileLocks.css";
import "./styles/folderColumns.css";
import "./styles/folderCustomization.css";
import "./styles/homeEditor.css";
import "./styles/image-edit.css";
import "./styles/indexedViews.css";
import "./styles/layers.css";
import "./styles/lockedFolders.css";
import "./styles/media-edit.css";
import "./styles/menuEditor.css";
import "./styles/office-audience.css";
import "./styles/office-deck.css";
import "./styles/office-document.css";
import "./styles/office-sheet.css";
import "./styles/office.css";
import "./styles/paint.css";
import "./styles/palette.css";
import "./styles/pdf-edit.css";
import "./styles/preferences.css";
import "./styles/privacy.css";
import "./styles/recovery.css";
import "./styles/search.css";
import "./styles/setupImport.css";
import "./styles/sheet-ai.css";
import "./styles/shelf.css";
import "./styles/shellFields.css";
import "./styles/shortcuts.css";
import "./styles/splitView.css";
import "./styles/storage.css";
import "./styles/tabGroups.css";
import "./styles/tabs-sessions.css";
import "./styles/tags.css";
import "./styles/themeEditor.css";
import "./styles/timeline.css";
import "./styles/toolbarCustomizer.css";
import "./styles/transfer.css";
import "./styles/transfers.css";
import "./styles/updates.css";
import "./styles/windowsIntegration.css";

// Registered before the first document can open; the function is idempotent,
// so a StrictMode double import never registers twice.
registerLockedDocumentProvider();
// One trusted bootstrap registration for the three Office editor families;
// each controller fails closed until its approved engine exists.
registerOfficeEditorControllers();
// Step 17c: the three AI-search schemas and their en/es prompts join the 17a
// registries once, before any host can prepare an inference request.
registerAiSearchRegistrations();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);