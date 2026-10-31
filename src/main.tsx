import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
import "./styles/tokens.css";
import "./styles/appearance.css";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/columns.css";
import "./styles/filetabs.css";
import "./styles/ribbon.css";
import "./styles/viewers.css";
import "./styles/media.css";
import "./styles/hex.css";
import "./styles/settings.css";
import "./styles/layout.css";
import "./styles/archive.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);