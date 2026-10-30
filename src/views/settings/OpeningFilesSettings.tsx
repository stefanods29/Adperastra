import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import SearchBox from "../../components/SearchBox";
import Switch from "../../components/Switch";
import { handlers } from "../../handlers";
import type { OpenSettings, OpenWith } from "../../services/settings";

export interface DefaultAppGroup {
  id: string;
  labelKey: string;
  extensions: string[];
}

/** The file types that have a built-in viewer, one group per viewer. An
 * extension two viewers know (".md") belongs to the first one registered. */
export function defaultAppGroups(): DefaultAppGroup[] {
  const seen = new Set<string>();
  const groups: DefaultAppGroup[] = [];
  for (const handler of handlers.list()) {
    const extensions = handler.extensions.filter((ext) => !seen.has(ext));
    for (const ext of extensions) seen.add(ext);
    if (extensions.length > 0) groups.push({ id: handler.id, labelKey: handler.labelKey, extensions: [...extensions].sort() });
  }
  return groups;
}

/** New `open_with` after choosing `choice` for `extensions`. Only
 * "windows" is stored; "builtin" is the default and removes the entry. */
export function withChoice(openWith: Readonly<Record<string, OpenWith>>, extensions: readonly string[], choice: OpenWith): Record<string, OpenWith> {
  const next: Record<string, OpenWith> = { ...openWith };
  for (const ext of extensions) {
    if (choice === "windows") next[ext] = "windows";
    else delete next[ext];
  }
  return next;
}

export interface OpeningFilesSettingsProps {
  open: OpenSettings;
  onChange: (open: OpenSettings) => void;
  onOpenHelp: (slug: string) => void;
}

/** Settings > Opening files (Step 04c): protected view and Default apps. */
export default function OpeningFilesSettings({ open, onChange, onOpenHelp }: OpeningFilesSettingsProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => defaultAppGroups(), []);
  const query = filter.trim().replace(/^\./, "").toLowerCase();
  const choiceOf = (ext: string): OpenWith => (Object.hasOwn(open.open_with, ext) ? open.open_with[ext] : "builtin");
  const choose = (extensions: readonly string[], choice: OpenWith) => onChange({ ...open, open_with: withChoice(open.open_with, extensions, choice) });
  const visibleGroups = groups
    .map((group) => ({ group, shown: query ? group.extensions.filter((ext) => ext.includes(query)) : group.extensions }))
    .filter((entry) => entry.shown.length > 0);

  return (
    <section className="adp-settings-section" aria-labelledby="adp-opening-files-title">
      <div className="adp-view-header">
        <h3 id="adp-opening-files-title" className="adp-heading">
          {t("settings.openingFiles")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("default-apps")} />
      </div>
      <div className="adp-setting-row">
        <Switch checked={open.protected_view} label={t("settings.protectedView")} onChange={(checked) => onChange({ ...open, protected_view: checked })} />
        <p className="adp-note">{t("settings.protectedViewNote")}</p>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.defaultApps")}</span>
        <p className="adp-note">{t("settings.defaultAppsNote")}</p>
        <div className="adp-defaultapps-search">
          <SearchBox value={filter} onChange={setFilter} placeholder={t("settings.findFileType")} />
        </div>
        {visibleGroups.length === 0 ? <p className="adp-note">{t("settings.noFileTypes")}</p> : null}
        {visibleGroups.map(({ group, shown }) => {
          const choices = new Set(group.extensions.map(choiceOf));
          const groupValue = choices.size === 1 ? [...choices][0] : "mixed";
          const isOpen = query !== "" || expanded === group.id;
          const name = t(group.labelKey);
          return (
            <div key={group.id} className="adp-defaultapps-group">
              <div className="adp-defaultapps-head">
                <button
                  type="button"
                  className="adp-defaultapps-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                >
                  <ChevronRight size={16} aria-hidden="true" className={isOpen ? "adp-defaultapps-chevron adp-defaultapps-chevron--open" : "adp-defaultapps-chevron"} />
                  <span className="adp-defaultapps-name">{name}</span>
                  <span className="adp-note">{t("settings.fileTypeCount", { count: group.extensions.length })}</span>
                </button>
                <select
                  className="adp-defaultapps-select"
                  aria-label={t("settings.openGroupWith", { name })}
                  value={groupValue}
                  onChange={(event) => choose(group.extensions, event.target.value as OpenWith)}
                >
                  {groupValue === "mixed" ? (
                    <option value="mixed" disabled>
                      {t("settings.openMixed")}
                    </option>
                  ) : null}
                  <option value="builtin">{t("settings.openInAdperastra")}</option>
                  <option value="windows">{t("settings.openInWindowsApp")}</option>
                </select>
              </div>
              {isOpen ? (
                <ul className="adp-defaultapps-list">
                  {shown.map((ext) => (
                    <li key={ext} className="adp-defaultapps-item">
                      <span className="adp-defaultapps-ext">.{ext}</span>
                      <select
                        className="adp-defaultapps-select"
                        aria-label={t("settings.openTypeWith", { ext })}
                        value={choiceOf(ext)}
                        onChange={(event) => choose([ext], event.target.value as OpenWith)}
                      >
                        <option value="builtin">{t("settings.openInAdperastra")}</option>
                        <option value="windows">{t("settings.openInWindowsApp")}</option>
                      </select>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
