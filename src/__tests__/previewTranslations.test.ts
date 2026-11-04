import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const NEW_KEYS: Record<string, [string, string]> = {
  "commands.quickPreview": ["Quick preview", "Vista previa rápida"],
  "preview.previous": ["Previous file", "Archivo anterior"],
  "preview.next": ["Next file", "Archivo siguiente"],
  "preview.open": ["Open", "Abrir"],
  "preview.readOnly": ["Preview only", "Solo vista previa"],
  "preview.unavailable": [
    "No preview is available for this file.",
    "No hay una vista previa disponible para este archivo.",
  ],
  "preview.onlineOnly": [
    "Open this online-only file to download it.",
    "Abre este archivo solo en línea para descargarlo.",
  ],
  "preview.loading": ["Preparing preview…", "Preparando la vista previa…"],
  "metadata.width": ["Width", "Ancho"],
  "metadata.height": ["Height", "Alto"],
  "metadata.orientation": ["Orientation", "Orientación"],
  "metadata.dateTaken": ["Date taken", "Fecha de captura"],
  "metadata.cameraMake": ["Camera manufacturer", "Fabricante de la cámara"],
  "metadata.cameraModel": ["Camera model", "Modelo de cámara"],
  "metadata.duration": ["Duration", "Duración"],
  "metadata.codec": ["Video codec", "Códec de video"],
  "metadata.frameRate": ["Frame rate", "Fotogramas por segundo"],
  "metadata.title": ["Title", "Título"],
  "metadata.artist": ["Artist", "Artista"],
  "metadata.album": ["Album", "Álbum"],
  "metadata.author": ["Author", "Autor"],
  "metadata.pages": ["Pages", "Páginas"],
  "metadata.words": ["Words", "Palabras"],
  "metadata.partial": [
    "Some details are not available.",
    "Algunos detalles no están disponibles.",
  ],
  "metadata.pixels": ["{count} px", "{count} px"],
  "metadata.fps": ["{count} fps", "{count} fps"],
  "errors.metadata.bad_request": [
    "This details request is not valid.",
    "La solicitud de detalles no es válida.",
  ],
  "errors.metadata.changed": [
    "The file changed. Select it again.",
    "El archivo cambió. Vuelve a seleccionarlo.",
  ],
  "errors.metadata.too_large": [
    "These details are too large to display.",
    "Estos detalles son demasiado extensos para mostrarlos.",
  ],
  "errors.metadata.failed": [
    "These file details could not be read.",
    "No se pudieron leer los detalles del archivo.",
  ],
};

function lookup(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value !== null && typeof value === "object") {
      return (value as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

describe("preview translations", () => {
  it("every new key exists in English and Spanish with the guide's text", () => {
    for (const [key, [english, spanish]] of Object.entries(NEW_KEYS)) {
      expect(lookup(en, key), `en ${key}`).toBe(english);
      expect(lookup(es, key), `es ${key}`).toBe(spanish);
    }
  });

  it("the quick preview help page exists in both languages", () => {
    for (const language of ["en", "es"]) {
      const text = readFileSync(join(root, "help", language, "quick-preview.md"), "utf8");
      expect(text).toMatch(/^# /);
      expect(text).toContain("## ");
      expect(text).toMatch(/See also|Consulta también/);
    }
    expect(readFileSync(join(root, "help", "en", "quick-preview.md"), "utf8")).toContain(
      "Look inside a file without opening another tab.",
    );
    expect(readFileSync(join(root, "help", "es", "quick-preview.md"), "utf8")).toContain(
      "Mira un archivo sin abrir otra pestaña.",
    );
  });

  it("the file details help page exists in both languages", () => {
    expect(readFileSync(join(root, "help", "en", "file-details.md"), "utf8")).toContain(
      "The Details pane can show picture, music, video and document information.",
    );
    expect(readFileSync(join(root, "help", "es", "file-details.md"), "utf8")).toContain(
      "El Panel de detalles puede mostrar información de imágenes, música, videos y documentos.",
    );
  });
});
