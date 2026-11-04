import { FolderPlus, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "../components/Switch";
import { formatSize } from "../services/format";
import {
  SEARCH_INDEX_LIMITS_MB,
  type IndexRoot,
  type IndexStatus,
  type SearchSettings,
} from "../services/search";

export interface IndexSettingsProps {
  settings: SearchSettings;
  status: IndexStatus;
  onChange: (next: SearchSettings) => void;
  onAddRoot: () => Promise<string | null>;
  onPause: (paused: boolean) => Promise<void>;
  onRebuild: (rootIds: readonly string[]) => Promise<void>;
  onOpenStorage: () => void;
  onOpenHelp: (slug: string) => void;
}

const CONTENT_CHARS = [10_000, 50_000, 100_000] as const;

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function newRoot(path: string): IndexRoot {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : fallbackUuid();
  return { id, path, filename: true, content: false, ocr: false, enabled: true };
}

/** Settings > Indexing (Step 11a T5). Every content and OCR switch is
 * separate and unchecked until the user enables it for that root. */
export default function IndexSettings({
  settings,
  status,
  onChange,
  onAddRoot,
  onPause,
  onRebuild,
  onOpenStorage,
  onOpenHelp,
}: IndexSettingsProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const updateRoot = (id: string, patch: Partial<IndexRoot>) => {
    onChange({
      ...settings,
      roots: settings.roots.map((root) => {
        if (root.id !== id) return root;
        const next = { ...root, ...patch };
        // Native includes a root only while names are indexed; content and
        // OCR cannot be on for a root that is not part of the index.
        if (!next.filename) next.content = false;
        if (!next.content) next.ocr = false;
        return next;
      }),
    });
  };

  const addRoot = async () => {
    setBusy(true);
    try {
      const path = await onAddRoot();
      if (path) onChange({ ...settings, roots: [...settings.roots, newRoot(path)] });
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      await onRebuild([...selected]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adp-index-settings" aria-labelledby="adp-index-settings-title">
      <div className="adp-settings-heading">
        <h2 id="adp-index-settings-title">{t("search.index")}</h2>
        <button
          type="button"
          className="adp-btn"
          onClick={() => onOpenHelp("indexing-and-privacy")}
        >
          {t("search.help")}
        </button>
      </div>

      <p className={`adp-index-status${status.coverage !== "complete" ? " adp-index-status--partial" : ""}`}>
        {status.running
          ? t("search.loading")
          : t("search.count", { count: status.files_count })}
        {" · "}
        {formatSize(status.disk_bytes, i18n.language)}
      </p>
      {status.coverage !== "complete" ? (
        <p className="adp-index-warning" role="status">
          {t("search.partial")}
        </p>
      ) : null}
      {status.limit_reached ? (
        <p className="adp-index-warning" role="alert">
          {t("errors.search.index_limit")}
        </p>
      ) : null}

      <div className="adp-index-actions">
        <button
          type="button"
          className="adp-btn"
          disabled={busy || settings.roots.length >= 32}
          onClick={() => void addRoot()}
        >
          <FolderPlus size={16} aria-hidden="true" />
          {t("search.addRoot")}
        </button>
        <button
          type="button"
          className="adp-btn"
          disabled={busy}
          onClick={() => void onPause(!status.paused)}
        >
          {status.paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          {t(status.paused ? "search.resume" : "search.pause")}
        </button>
        <button type="button" className="adp-btn" disabled={busy} onClick={() => void rebuild()}>
          <RefreshCw size={16} aria-hidden="true" />
          {t("search.rebuild")}
        </button>
        <button type="button" className="adp-btn" onClick={onOpenStorage}>
          {t("search.openStorage")}
        </button>
      </div>

      <ul className="adp-index-roots">
        {settings.roots.map((root) => (
          <li className="adp-index-root" key={root.id}>
            <label className="adp-index-root__select">
              <input
                type="checkbox"
                checked={selected.has(root.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(root.id);
                  else next.delete(root.id);
                  setSelected(next);
                }}
                aria-label={root.path}
              />
              <span className="adp-index-root__path">{root.path}</span>
            </label>
            <div className="adp-index-root__options">
              <Switch
                checked={root.filename}
                label={t("search.name")}
                onChange={(filename) => updateRoot(root.id, { filename })}
              />
              <Switch
                checked={root.content}
                label={t("search.contentOptIn")}
                disabled={!root.filename}
                onChange={(content) => updateRoot(root.id, { content })}
              />
              <Switch
                checked={root.ocr}
                label={t("search.ocrOptIn")}
                disabled={!root.content}
                onChange={(ocr) => updateRoot(root.id, { ocr })}
              />
              <Switch
                checked={root.enabled}
                label={t("search.index")}
                onChange={(enabled) => updateRoot(root.id, { enabled })}
              />
              <button
                type="button"
                className="adp-icon-btn"
                aria-label={t("search.removeRoot")}
                title={t("search.removeRoot")}
                onClick={() => {
                  const next = new Set(selected);
                  next.delete(root.id);
                  setSelected(next);
                  onChange({
                    ...settings,
                    roots: settings.roots.filter((entry) => entry.id !== root.id),
                  });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="adp-index-fields">
        <label>
          <span>{t("search.indexLimit")}</span>
          <select
            className="adp-input"
            value={settings.index_limit_mb}
            onChange={(event) =>
              onChange({ ...settings, index_limit_mb: Number(event.target.value) })
            }
          >
            {SEARCH_INDEX_LIMITS_MB.map((limit) => (
              <option key={limit} value={limit}>
                {formatSize(limit * 1024 * 1024, i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("search.contentMax")}</span>
          <select
            className="adp-input"
            value={settings.content_max_chars}
            onChange={(event) =>
              onChange({ ...settings, content_max_chars: Number(event.target.value) })
            }
          >
            {!(CONTENT_CHARS as readonly number[]).includes(settings.content_max_chars) ? (
              <option value={settings.content_max_chars}>
                {settings.content_max_chars.toLocaleString(i18n.language)}
              </option>
            ) : null}
            {CONTENT_CHARS.map((chars) => (
              <option key={chars} value={chars}>
                {chars.toLocaleString(i18n.language)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="adp-index-usn">
        <Switch
          checked={settings.usn_enabled}
          label={t("search.usn")}
          onChange={(usn_enabled) => onChange({ ...settings, usn_enabled })}
        />
        <p>{t("search.usnWarning")}</p>
      </div>
    </section>
  );
}
