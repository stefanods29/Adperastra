import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);