/** Edit Home sections: show, collapse, move and resize registered sections
 * (Step 10e T3). Apply is one atomic settings change; Cancel keeps the saved
 * layout; the header stays reachable for every section (D4). */
import { MoveDown, MoveUp, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import { defaultHomeCustomization } from "./registries";
import { mergeHomeLayout, safeHomeLimit, sectionLabelKey } from "./homeProviders";
import {
  HOME_SECTION_SIZES,
  type HomeCustomization,
  type HomeSectionProvider,
  type HomeSectionSize,
} from "./types";
import { validateHomeCustomization } from "./validation";

export interface HomeEditorProps {
  value: HomeCustomization;
  providers: readonly HomeSectionProvider[];
  onApply: (value: HomeCustomization) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: (slug?: string) => void;
}

const SIZE_LABEL_KEYS = {
  small: "shellCustom.sizeSmall",
  medium: "shellCustom.sizeMedium",
  large: "shellCustom.sizeLarge",
} as const;

export default function HomeEditor(props: HomeEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<HomeCustomization>(() => mergeHomeLayout(props.value, props.providers));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (id: string, patch: Partial<HomeCustomization["sections"][number]>) => {
    setDraft((current) => ({
      sections: current.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
    }));
  };

  const move = (id: string, direction: -1 | 1) => {
    setDraft((current) => {
      const index = current.sections.findIndex((section) => section.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.sections.length) return current;
      const sections = [...current.sections];
      const [section] = sections.splice(index, 1);
      sections.splice(next, 0, section);
      return { sections };
    });
  };

  const apply = async () => {
    const validated = validateHomeCustomization(draft);
    if (!validated) {
      setError(new Error("catalog.invalid"));
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await props.onApply(validated);
    } catch (failure) {
      setError(failure);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="adp-home-editor" aria-label={t("shellCustom.home")}>
      <div className="adp-view-header">
        <h3 className="adp-heading">{t("shellCustom.home")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("customizing-home-navigation-status")} />
      </div>

      <div className="adp-home-editor__rows">
        {draft.sections.map((section, index) => {
          const provider = props.providers.find((entry) => entry.id === section.id) ?? null;
          const label = provider ? t(provider.label_key) : t(sectionLabelKey(section.id));
          return (
            <div key={section.id} className="adp-home-editor__row" data-home-section={section.id}>
              <div className="adp-home-editor__identity">
                <span className="adp-home-editor__label">{label}</span>
                {provider ? null : <span className="adp-home-editor__missing">{t("toolbarCustom.missing")}</span>}
              </div>
              <div className="adp-home-editor__controls">
                <Switch
                  checked={section.visible}
                  label={section.visible ? t("shellCustom.hide") : t("shellCustom.show")}
                  onChange={(visible) => update(section.id, { visible })}
                />
                <Switch
                  checked={section.collapsed}
                  label={t("shellCustom.collapse")}
                  disabled={!section.visible}
                  onChange={(collapsed) => update(section.id, { collapsed })}
                />
                <select
                  className="adp-defaultapps-select"
                  aria-label={t("shellCustom.cardSize")}
                  data-home-field="size"
                  value={section.size}
                  onChange={(event) => update(section.id, { size: event.target.value as HomeSectionSize })}
                >
                  {HOME_SECTION_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {t(SIZE_LABEL_KEYS[size])}
                    </option>
                  ))}
                </select>
                <label className="adp-home-editor__limit">
                  <span>{t("shellCustom.count")}</span>
                  <TextInput
                    type="number"
                    ariaLabel={t("shellCustom.count")}
                    value={String(section.limit)}
                    onChange={(text) => update(section.id, { limit: safeHomeLimit(Number(text)) })}
                  />
                </label>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.up")}
                  title={t("shellCustom.up")}
                  disabled={index === 0}
                  onClick={() => move(section.id, -1)}
                >
                  <MoveUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.down")}
                  title={t("shellCustom.down")}
                  disabled={index === draft.sections.length - 1}
                  onClick={() => move(section.id, 1)}
                >
                  <MoveDown size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="adp-home-editor__error">{errorText(t, error, "catalog")}</p> : null}
      <div className="adp-home-editor__actions">
        <Button disabled={applying} onClick={() => void apply()}>
          {t("common.apply")}
        </Button>
        <Button disabled={applying} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={applying}
          onClick={() => setDraft(mergeHomeLayout(defaultHomeCustomization(), props.providers))}
        >
          <RotateCcw size={16} aria-hidden="true" /> {t("shellCustom.reset")}
        </Button>
      </div>
    </section>
  );
}
