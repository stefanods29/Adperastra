import { useTranslation } from "react-i18next";
import { formatSize } from "../../services/format";
import type { IndexRoot } from "../../services/search";
import type { AiDestination, AiSearchSettings, SemanticStatus } from "../../services/aiSearchTypes";
import { AI_SEARCH_OPT_INS, removeDestination, setOptIn, setSemanticRoot } from "../../search/ai/aiSearchSettings";

export interface AiSearchSettingsSectionProps {
  settings: AiSearchSettings;
  indexRoots: IndexRoot[];
  sensitiveRootIds?: string[];
  status?: SemanticStatus | null;
  storageBytes?: number | null;
  destinations?: AiDestination[];
  onChange: (settings: AiSearchSettings) => void;
  onResetHistory?: () => void;
  onAddDestination?: () => void;
  onOpenHelp: (slug: string) => void;
}

const OPT_IN_KEYS: Record<(typeof AI_SEARCH_OPT_INS)[number], string> = {
  semantic_text: "aiSearch.textOptIn",
  photo_index: "aiSearch.photoOptIn",
  natural_query: "aiSearch.natural",
  rename: "aiSearch.suggestName",
  sort: "aiSearch.sort",
};

/** Settings > AI: five independent opt-ins, roots, coverage and storage. */
export default function AiSearchSettingsSection({
  settings,
  indexRoots,
  sensitiveRootIds = [],
  status,
  storageBytes,
  destinations = settings.destinations,
  onChange,
  onResetHistory,
  onAddDestination,
  onOpenHelp,
}: AiSearchSettingsSectionProps) {
  const { t, i18n } = useTranslation();
  const sensitive = new Set(sensitiveRootIds);

  return (
    <section className="adp-settings-section ai-search-settings" aria-labelledby="ai-search-settings-title">
      <h2 id="ai-search-settings-title">{t("aiSearch.title")}</h2>
      <fieldset className="ai-search-settings__opt-ins">
        <legend>{t("aiSearch.title")}</legend>
        {AI_SEARCH_OPT_INS.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => onChange(setOptIn(settings, key, event.target.checked))}
            />
            <span>{t(OPT_IN_KEYS[key])}</span>
          </label>
        ))}
      </fieldset>

      <div className="ai-search-settings__roots">
        <h3>{t("search.roots")}</h3>
        {settings.roots.length === 0 ? (
          <p>{t("aiSearch.empty")}</p>
        ) : (
          settings.roots.map((root) => {
            const label = indexRoots.find((entry) => entry.id === root.root_id)?.path ?? root.root_id;
            return (
              <div className="ai-search-settings__root" key={root.root_id}>
                <span>{label}</span>
                <label>
                  <input
                    type="checkbox"
                    checked={root.text}
                    disabled={sensitive.has(root.root_id)}
                    onChange={(event) => onChange(setSemanticRoot(settings, root.root_id, "text", event.target.checked))}
                  />
                  {t("aiSearch.textOptIn")}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={root.photos}
                    disabled={sensitive.has(root.root_id)}
                    onChange={(event) => onChange(setSemanticRoot(settings, root.root_id, "photos", event.target.checked))}
                  />
                  {t("aiSearch.photoOptIn")}
                </label>
              </div>
            );
          })
        )}
      </div>

      <div className="ai-search-settings__destinations">
        <h3>{t("aiSearch.sort")}</h3>
        {destinations.length === 0 ? (
          <p>{t("aiSearch.empty")}</p>
        ) : (
          destinations.map((destination) => (
            <div className="ai-search-settings__destination" key={destination.id}>
              <span>{destination.name}</span>
              <span>{destination.path}</span>
              <button
                type="button"
                className="adp-btn"
                onClick={() => onChange(removeDestination(settings, destination.id))}
              >
                {t("storage.clear")}
              </button>
            </div>
          ))
        )}
        {onAddDestination ? (
          <button type="button" className="adp-btn" onClick={onAddDestination}>
            {t("search.addRoot")}
          </button>
        ) : null}
        {onResetHistory ? (
          <button type="button" className="adp-btn" onClick={onResetHistory}>
            {t("aiSearch.reset")}
          </button>
        ) : null}
      </div>

      <p className="ai-search-settings__coverage" role="status">
        {status?.reason_code === "ai_search.unavailable"
          ? t("errors.ai_search.unavailable")
          : status
            ? t("aiSearch.coverage", { done: status.text_chunks + status.images, skipped: status.skipped })
            : t("components.loading")}
        {storageBytes !== null && storageBytes !== undefined
          ? ` · ${formatSize(storageBytes, i18n.language === "es" ? "es" : "en")}`
          : ""}
      </p>
      <button type="button" className="adp-btn" onClick={() => onOpenHelp("indexing-and-privacy")}>
        {t("search.help")}
      </button>
    </section>
  );
}
