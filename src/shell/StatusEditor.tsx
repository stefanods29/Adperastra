/** Status bar field editor (Step 10e T4).
 *
 * Fields belong to the view that registered them. The editor changes order
 * and visibility only; it never copies editor state into a second source and
 * never reads a getter. Hiding the whole bar is allowed because save, error
 * and progress messages remain visible elsewhere (D6).
 */
import { MoveDown, MoveUp, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import Switch from "../components/Switch";
import { errorText } from "../services/errors";
import { defaultStatusCustomization, STATUS_FIELD_LABEL_KEYS } from "./registries";
import {
  STATUS_KINDS,
  type StatusCustomization,
  type StatusFieldOrderEntry,
  type StatusKind,
} from "./types";
import { validateStatusCustomization } from "./validation";

export interface StatusFieldChoice {
  id: string;
  labelKey: string;
}

export interface StatusEditorProps {
  value: StatusCustomization;
  /** Registered fields per view; missing kinds fall back to the saved ids. */
  fields?: Partial<Record<StatusKind, readonly StatusFieldChoice[]>>;
  onApply: (value: StatusCustomization) => Promise<void>;
  onCancel: () => void;
  onOpenHelp: (slug?: string) => void;
}

export const STATUS_KIND_LABEL_KEYS: Readonly<Record<StatusKind, string>> = {
  explorer: "shellCustom.kindExplorer",
  text: "shellCustom.kindText",
  pdf: "shellCustom.kindPdf",
  image: "shellCustom.kindImage",
  media: "shellCustom.kindMedia",
  office: "shellCustom.kindOffice",
};

function mergeOrders(
  value: StatusCustomization,
  fields: StatusEditorProps["fields"],
): StatusCustomization {
  const orders = {} as StatusCustomization["orders"];
  for (const kind of STATUS_KINDS) {
    const current = (value.orders[kind] ?? []).map((entry) => ({ ...entry }));
    const known = new Set(current.map((entry) => entry.id));
    for (const field of fields?.[kind] ?? []) {
      if (!known.has(field.id)) current.push({ id: field.id, visible: false });
    }
    orders[kind] = current;
  }
  return { visible: value.visible, orders };
}

export default function StatusEditor(props: StatusEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<StatusCustomization>(() => mergeOrders(props.value, props.fields));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setOrder = (kind: StatusKind, entries: StatusFieldOrderEntry[]) =>
    setDraft((current) => ({ ...current, orders: { ...current.orders, [kind]: entries } }));

  const move = (kind: StatusKind, id: string, direction: -1 | 1) => {
    const entries = [...draft.orders[kind]];
    const index = entries.findIndex((entry) => entry.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= entries.length) return;
    const [entry] = entries.splice(index, 1);
    entries.splice(next, 0, entry);
    setOrder(kind, entries);
  };

  const labelFor = (kind: StatusKind, id: string): string => {
    const field = props.fields?.[kind]?.find((entry) => entry.id === id);
    return t(field?.labelKey ?? STATUS_FIELD_LABEL_KEYS[id] ?? "toolbarCustom.missing");
  };

  const apply = async () => {
    const validated = validateStatusCustomization(draft);
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
    <section className="adp-status-editor adp-settings-section" aria-label={t("shellCustom.status")}>
      <div className="adp-view-header">
        <h3 className="adp-heading">{t("shellCustom.status")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("customizing-home-navigation-status")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("shellCustom.show")}</span>
        <Switch checked={draft.visible} onChange={(visible) => setDraft((current) => ({ ...current, visible }))} />
      </div>

      {STATUS_KINDS.map((kind) => (
        <div key={kind} className="adp-status-editor__kind" data-status-kind={kind}>
          <h4 className="adp-heading">{t(STATUS_KIND_LABEL_KEYS[kind])}</h4>
          {draft.orders[kind].map((entry, index) => (
            <div key={entry.id} className="adp-setting-row" data-status-field={entry.id}>
              <span className="adp-setting-label">{labelFor(kind, entry.id)}</span>
              <div className="adp-button-row">
                <Switch
                  checked={entry.visible}
                  label={entry.visible ? t("shellCustom.hide") : t("shellCustom.show")}
                  onChange={(visible) =>
                    setOrder(
                      kind,
                      draft.orders[kind].map((candidate) =>
                        candidate.id === entry.id ? { ...candidate, visible } : candidate,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.up")}
                  title={t("shellCustom.up")}
                  disabled={index === 0}
                  onClick={() => move(kind, entry.id, -1)}
                >
                  <MoveUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("shellCustom.down")}
                  title={t("shellCustom.down")}
                  disabled={index === draft.orders[kind].length - 1}
                  onClick={() => move(kind, entry.id, 1)}
                >
                  <MoveDown size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {error ? <p className="adp-menu-editor__error">{errorText(t, error, "catalog")}</p> : null}
      <div className="adp-button-row">
        <Button disabled={applying} onClick={() => void apply()}>
          {t("common.apply")}
        </Button>
        <Button disabled={applying} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button disabled={applying} onClick={() => setDraft(mergeOrders(defaultStatusCustomization(), props.fields))}>
          <RotateCcw size={16} aria-hidden="true" /> {t("shellCustom.reset")}
        </Button>
      </div>
    </section>
  );
}
