import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import Slider from "../components/Slider";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import { ColumnSetEditor } from "./ColumnSetEditor";
import { FolderGlyph } from "./FolderGlyph";
import { errorText } from "../services/errors";
import {
  listColumnSets,
  readFolderIdentityKeys,
  saveColumnSet,
  validFolderIcon,
  type ColumnSet,
  type FolderBackground,
  type FolderCustomizeRequest,
  type FolderDecoration,
  type FolderIcon,
} from "../services/folderCustomization";
import { validColumns } from "../services/folderPresentation";

export interface FolderCustomizeDialogProps {
  paths: readonly string[];
  initial: readonly FolderDecoration[];
  columnSetsEnabled?: boolean;
  onApply: (request: FolderCustomizeRequest) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
  onOpenHelp: () => void;
}

type Tab = "general" | "background" | "columns";

const LUCIDE_ICONS = ["folder", "folderOpen", "folderHeart", "folderStar", "folderLock"] as const;
const SOLID_COLOR = "#DFB22B";
const SECOND_COLOR = "#0078D4";

function noneBackground(): FolderBackground {
  return { kind: "none", angle_degrees: 0, fit: "fit", opacity: 0.15, blur_px: 0, inherit: false };
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function patchFor(
  initial: FolderDecoration | undefined,
  color: string | null,
  icon: FolderIcon,
  background: FolderBackground,
  columnSetId: string | undefined,
  scope: "exact" | "subtree",
): FolderCustomizeRequest["patch"] {
  const patch: FolderCustomizeRequest["patch"] = {};
  if ((initial?.color ?? null) !== color) patch.color = color;
  if (!same(initial?.icon ?? { kind: "default" }, icon)) patch.icon = icon;
  if (!same(initial?.background ?? noneBackground(), background)) patch.background = background;
  if ((initial?.column_set?.id ?? undefined) !== columnSetId && columnSetId) patch.column_set_id = columnSetId;
  if (scope === "subtree") patch.scope = scope;
  return patch;
}

/** Draft-only dialog: nothing is written before Apply. Background images,
 * catalog image icons and Windows Explorer writes stay disabled until their
 * asset/replacement adapters exist; ordinary app appearance does not. */
export default function FolderCustomizeDialog(props: FolderCustomizeDialogProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const initial = props.initial[0];
  const [tab, setTab] = useState<Tab>("general");
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [icon, setIcon] = useState<FolderIcon>(initial?.icon ?? { kind: "default" });
  const [emoji, setEmoji] = useState(initial && initial.icon.kind === "emoji" ? initial.icon.value ?? "" : "");
  const [background, setBackground] = useState<FolderBackground>(initial?.background ?? noneBackground());
  const [columnSetId, setColumnSetId] = useState<string | undefined>(initial?.column_set?.id);
  const [scope, setScope] = useState<"exact" | "subtree">("exact");
  const [sets, setSets] = useState<ColumnSet[]>([]);
  const [editing, setEditing] = useState<ColumnSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.columnSetsEnabled) return;
    let active = true;
    listColumnSets()
      .then((value) => { if (active) setSets(value); })
      .catch(() => { if (active) setSets([]); });
    return () => { active = false; };
  }, [props.columnSetsEnabled]);

  const patch = patchFor(initial, color, icon, background, columnSetId, scope);
  const dirty = Object.values(patch).some((value) => value !== undefined);

  const apply = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const expectedKeys = await readFolderIdentityKeys(props.paths);
      await props.onApply({
        paths: [...props.paths],
        patch,
        expected_keys: expectedKeys,
        apply_windows: false,
        accepted_windows_change: false,
      });
    } catch (reason) {
      setError(errorText(t, reason, "folder_custom"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onReset();
    } catch (reason) {
      setError(errorText(t, reason, "folder_custom"));
    } finally {
      setBusy(false);
    }
  };

  const saveSet = async () => {
    if (!editing || !validColumns(editing.columns) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveColumnSet(editing);
      setSets((current) => [...current.filter((set) => set.id !== saved.id), saved]);
      setEditing(null);
      setColumnSetId(saved.id);
    } catch (reason) {
      setError(errorText(t, reason, "folder_custom"));
    } finally {
      setBusy(false);
    }
  };

  const changeKind = (kind: FolderBackground["kind"]) => {
    setBackground((current) => ({ ...current, kind,
      color: kind === "solid" || kind === "gradient" ? current.color ?? SOLID_COLOR : current.color,
      second_color: kind === "gradient" ? current.second_color ?? SECOND_COLOR : current.second_color }));
  };

  const previewBackground = background.kind === "solid" && background.color
    ? { backgroundColor: background.color }
    : background.kind === "gradient" && background.color && background.second_color
      ? { backgroundImage: `linear-gradient(${background.angle_degrees}deg, ${background.color}, ${background.second_color})` }
      : undefined;

  return <Dialog title={t("folderCustom.title")} onClose={props.onClose} className="adp-folder-customize">
    <div className="adp-folder-customize-tabs" role="tablist" aria-label={t("folderCustom.title")}>
      {(["general", "background", "columns"] as const).map((id) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id}
          className={tab === id ? "adp-folder-customize-tab adp-folder-customize-tab--active" : "adp-folder-customize-tab"}
          onClick={() => setTab(id)}>
          {id === "general" ? t("folderCustom.general") : id === "background" ? t("folderCustom.background") : t("folderCustom.columns")}
        </button>
      ))}
      <span className="adp-folder-customize-help"><HelpButton onOpenHelp={props.onOpenHelp} /></span>
    </div>

    <div className="adp-folder-customize-preview" style={previewBackground}>
      <span className="adp-file-tile adp-file-tile--folder"><FolderGlyph decoration={{ color: color ?? undefined, icon, warning_codes: [] }} size={32} /></span>
    </div>

    {tab === "general" ? <div className="adp-folder-customize-form">
      <span>{t("folderCustom.color")}</span>
      <div className="adp-folder-customize-row">
        <input id={`${prefix}-color`} className="adp-input" type="color" value={color ?? SOLID_COLOR}
          aria-label={t("folderCustom.color")} disabled={busy}
          onChange={(event) => setColor(event.target.value.toUpperCase())} />
        {color ? <Button variant="subtle" disabled={busy} onClick={() => setColor(null)}>{t("folderCustom.reset")}</Button> : null}
      </div>

      <span>{t("folderCustom.icon")}</span>
      <div className="adp-folder-customize-row" role="radiogroup" aria-label={t("folderCustom.icon")}>
        {(["default", ...LUCIDE_ICONS] as const).map((candidate) => {
          const candidateIcon: FolderIcon = candidate === "default" ? { kind: "default" } : { kind: "lucide", value: candidate };
          const checked = candidate === "default"
            ? icon.kind === "default"
            : icon.kind === "lucide" && icon.value === candidate;
          return <button key={candidate} type="button" role="radio" aria-checked={checked}
            aria-label={t("folderCustom.icon")}
            className={checked ? "adp-folder-customize-icon adp-folder-customize-icon--on" : "adp-folder-customize-icon"}
            disabled={busy}
            onClick={() => setIcon(candidateIcon)}>
            <FolderGlyph decoration={{ color: color ?? undefined, icon: candidateIcon, warning_codes: [] }} size={18} />
          </button>;
        })}
        <button type="button" className="adp-folder-customize-icon" disabled={busy}
          aria-label={t("folderCustom.emoji")} title={t("folderCustom.emoji")}
          onClick={() => setIcon(validFolderIcon({ kind: "emoji", value: emoji }) ? { kind: "emoji", value: emoji } : { kind: "default" })}>
          {t("folderCustom.emoji")}
        </button>
        <Button variant="subtle" disabled title={t("folderCustom.image")}>{t("folderCustom.image")}</Button>
      </div>

      {icon.kind === "emoji" || icon.kind === "default" ? <div className="adp-folder-customize-row">
        <TextInput value={emoji} maxLength={16} ariaLabel={t("folderCustom.emoji")} disabled={busy}
          invalid={emoji.length > 0 && !validFolderIcon({ kind: "emoji", value: emoji })}
          onChange={(value) => {
            setEmoji(value);
            setIcon(validFolderIcon({ kind: "emoji", value }) ? { kind: "emoji", value } : { kind: "default" });
          }} />
      </div> : null}

      <span>{t("folderCustom.windows")}</span>
      <div className="adp-folder-customize-row adp-folder-customize-column">
        <Switch checked={false} disabled label={t("folderCustom.windows")} onChange={() => undefined} />
        <p className="adp-note">{t("folderCustom.windowsWarning")}</p>
      </div>

      <span />
      <Switch checked={background.inherit} label={t("folderCustom.inherit")} disabled={busy}
        onChange={(checked) => setBackground((current) => ({ ...current, inherit: checked }))} />
    </div> : null}

    {tab === "background" ? <div className="adp-folder-customize-form">
      <span>{t("folderCustom.background")}</span>
      <select className="adp-defaultapps-select" aria-label={t("folderCustom.background")} disabled={busy}
        value={background.kind} onChange={(event) => changeKind(event.target.value as FolderBackground["kind"])}>
        <option value="none">{t("folderCustom.reset")}</option>
        <option value="solid">{t("folderCustom.color")}</option>
        <option value="gradient">{t("folderCustom.background")}</option>
        <option value="image" disabled>{t("folderCustom.image")}</option>
      </select>

      {background.kind === "solid" || background.kind === "gradient" ? <>
        <span>{t("folderCustom.color")}</span>
        <input className="adp-input" type="color" value={background.color?.slice(0, 7) ?? SOLID_COLOR}
          aria-label={t("folderCustom.color")} disabled={busy}
          onChange={(event) => setBackground((current) => ({ ...current, color: event.target.value.toUpperCase() }))} />
      </> : null}

      {background.kind === "gradient" ? <>
        <span>{t("folderCustom.background")}</span>
        <input className="adp-input" type="color" value={background.second_color?.slice(0, 7) ?? SECOND_COLOR}
          aria-label={t("folderCustom.background")} disabled={busy}
          onChange={(event) => setBackground((current) => ({ ...current, second_color: event.target.value.toUpperCase() }))} />
        <span>{t("folderCustom.background")}</span>
        <input className="adp-input" type="number" min={0} max={359} value={background.angle_degrees}
          aria-label={t("folderCustom.background")} disabled={busy}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isInteger(value) && value >= 0 && value <= 359) setBackground((current) => ({ ...current, angle_degrees: value }));
          }} />
      </> : null}

      <span>{t("folderCustom.dimmed")}</span>
      <input className="adp-slider" type="range" min={0} max={0.5} step={0.05} value={background.opacity}
        aria-label={t("folderCustom.dimmed")} disabled={busy || background.kind === "none"}
        onChange={(event) => setBackground((current) => ({ ...current, opacity: Number(event.target.value) }))} />

      <span>{t("folderCustom.background")}</span>
      <Slider value={background.blur_px} min={0} max={32} label={t("folderCustom.background")} disabled={busy}
        onChange={(value) => setBackground((current) => ({ ...current, blur_px: value }))} />

      <span />
      <Switch checked={background.inherit} label={t("folderCustom.inherit")} disabled={busy}
        onChange={(checked) => setBackground((current) => ({ ...current, inherit: checked }))} />
    </div> : null}

    {tab === "columns" ? <div className="adp-folder-customize-form">
      <span>{t("folderCustom.columns")}</span>
      {!props.columnSetsEnabled ? <p className="adp-note">{t("folderCustom.enableColumns")}</p> : <>
        <select className="adp-defaultapps-select" aria-label={t("folderCustom.assign")} disabled={busy || sets.length === 0}
          value={columnSetId ?? ""} onChange={(event) => setColumnSetId(event.target.value || undefined)}>
          <option value="">{t("folderCustom.assign")}</option>
          {sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
        </select>
        <span>{t("folderCustom.exact")}</span>
        <select className="adp-defaultapps-select" aria-label={t("folderCustom.assign")} disabled={busy}
          value={scope} onChange={(event) => setScope(event.target.value === "subtree" ? "subtree" : "exact")}>
          <option value="exact">{t("folderCustom.exact")}</option>
          <option value="subtree">{t("folderCustom.subtree")}</option>
        </select>
        {columnSetId ? <Button variant="subtle" disabled={busy} onClick={() => setEditing(sets.find((set) => set.id === columnSetId) ?? null)}>
          {t("folderCustom.columns")}
        </Button> : <span />}
        {editing ? <>
          <span />
          <ColumnSetEditor value={editing} onChange={setEditing} />
          <span />
          <Button variant="primary" disabled={busy} onClick={() => void saveSet()}>{t("folderCustom.assign")}</Button>
        </> : null}
      </>}
    </div> : null}

    {error ? <p className="adp-note" role="alert">{error}</p> : null}

    <div className="adp-folder-customize-actions">
      <Button disabled={busy} onClick={() => void reset()}>{t("folderCustom.reset")}</Button>
      <span className="adp-cmd-spacer" />
      <Button disabled={busy} onClick={props.onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" disabled={busy || !dirty} onClick={() => void apply()}>{t("common.apply")}</Button>
    </div>
  </Dialog>;
}
