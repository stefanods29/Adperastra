import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import type { ImageController, ImageModel } from "./types";

/** Optional 196 px history panel. It observes the shared controller; it does
 * not create a second history or a second document registry. */

export interface HistoryPanelProps {
  controller: ImageController;
  viewonly?: boolean;
}

interface Entry {
  content_id: string;
  label: string;
}

export default function HistoryPanel({ controller, viewonly }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>(() => [
    { content_id: controller.getModel().content_id, label: t("layers.historyStart") },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return controller.subscribe((model: Readonly<ImageModel>) => {
      setEntries((current) => {
        if (current[current.length - 1]?.content_id === model.content_id) return current;
        return [...current, { content_id: model.content_id, label: t("layers.historyEdit") }].slice(-100);
      });
    });
  }, [controller, t]);

  const run = async (operation: "undo" | "redo") => {
    if (viewonly || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (operation === "undo") await controller.undo();
      else await controller.redo();
      setError(null);
    } catch {
      setError(t("errors.image_layers.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="adp-layer-history" aria-label={t("layers.history")}>
      <header className="adp-layer-history-header">
        <h2>{t("layers.history")}</h2>
      </header>
      <div className="adp-layer-history-actions">
        <Button variant="subtle" data-adp-history="undo" disabled={viewonly || busy} onClick={() => void run("undo")}>
          <Undo2 size={14} aria-hidden="true" /> {t("common.undo")}
        </Button>
        <Button variant="subtle" data-adp-history="redo" disabled={viewonly || busy} onClick={() => void run("redo")}>
          <Redo2 size={14} aria-hidden="true" /> {t("common.redo")}
        </Button>
      </div>
      <ol className="adp-layer-history-list" aria-label={t("layers.history")}>
        {entries.map((entry, index) => (
          <li key={`${entry.content_id}-${index}`} className="adp-layer-history-row" aria-current={index === entries.length - 1 ? "true" : undefined}>
            {entry.label}
          </li>
        ))}
      </ol>
      {error ? <p className="adp-layer-error" role="alert">{error}</p> : null}
    </aside>
  );
}
