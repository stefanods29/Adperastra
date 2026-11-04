import { Circle, Hexagon, Move, PenTool, Pipette, Scaling, Square, Wand2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import type { SelectionMask, SelectionMode, SelectionOperation, SelectionTool } from "./selectionTypes";
import { MAX_FEATHER_RADIUS, SELECTION_MODES } from "./selectionTypes";

/** Selection tool and property controls. Canvas gestures stay in the
 * presenter; this component only changes view/tool state and issues explicit
 * invert/feather/clear operations. */

export interface SelectionToolsProps {
  selection: SelectionMask;
  tool: SelectionTool;
  onTool: (tool: SelectionTool) => void;
  onApply: (operation: SelectionOperation) => Promise<void>;
  mode?: SelectionMode;
  onModeChange?: (mode: SelectionMode) => void;
  tolerance?: number;
  onToleranceChange?: (tolerance: number) => void;
  disabled?: boolean;
}

const TOOLS: Array<{ id: SelectionTool; icon: LucideIcon; key: string }> = [
  { id: "rectangle", icon: Square, key: "selection.rectangle" },
  { id: "ellipse", icon: Circle, key: "selection.ellipse" },
  { id: "lasso", icon: PenTool, key: "selection.lasso" },
  { id: "polygon", icon: Hexagon, key: "selection.polygon" },
  { id: "wand", icon: Wand2, key: "selection.wand" },
  { id: "color", icon: Pipette, key: "selection.color" },
  { id: "move", icon: Move, key: "selection.move" },
  { id: "transform", icon: Scaling, key: "selection.transform" },
];

export default function SelectionTools(props: SelectionToolsProps) {
  const { t } = useTranslation();
  const [localMode, setLocalMode] = useState<SelectionMode>("replace");
  const [localTolerance, setLocalTolerance] = useState(15);
  const [feather, setFeather] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = props.mode ?? localMode;
  const tolerance = props.tolerance ?? localTolerance;
  const setMode = props.onModeChange ?? setLocalMode;
  const setTolerance = props.onToleranceChange ?? setLocalTolerance;
  const disabled = props.disabled === true;

  const apply = async (operation: SelectionOperation) => {
    if (disabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onApply(operation);
      setError(null);
    } catch {
      setError(t("errors.image_layers.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adp-selection-tools" aria-label={t("selection.title")} role="toolbar" aria-busy={busy}>
      <div className="adp-selection-tool-grid">
        {TOOLS.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            className="adp-selection-tool"
            data-adp-selection-tool={id}
            aria-label={t(key)}
            aria-pressed={props.tool === id}
            disabled={disabled}
            onClick={() => props.onTool(id)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="adp-selection-modes" role="group" aria-label={t("selection.mode")}>
        {SELECTION_MODES.map((entry) => (
          <button
            key={entry}
            type="button"
            className="adp-selection-mode"
            data-adp-selection-mode={entry}
            aria-pressed={mode === entry}
            disabled={disabled}
            onClick={() => setMode(entry)}
          >
            {t(`selection.${entry}`)}
          </button>
        ))}
      </div>

      {(props.tool === "wand" || props.tool === "color") ? (
        <label className="adp-selection-field">
          <span>{t("selection.tolerance")}</span>
          <input
            type="number"
            min={0}
            max={100}
            value={tolerance}
            aria-label={t("selection.tolerance")}
            disabled={disabled}
            onChange={(event) => setTolerance(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))}
          />
        </label>
      ) : null}

      <div className="adp-selection-actions">
        <Button variant="subtle" data-adp-selection-action="invert" disabled={disabled || busy} onClick={() => void apply({ kind: "invert" })}>
          {t("selection.invert")}
        </Button>
        <Button variant="subtle" data-adp-selection-action="clear" disabled={disabled || busy} onClick={() => void apply({ kind: "clear" })}>
          {t("selection.clear")}
        </Button>
      </div>

      <div className="adp-selection-field">
        <span>{t("selection.feather")}</span>
        <div className="adp-selection-feather">
          <input
            type="number"
            min={0}
            max={MAX_FEATHER_RADIUS}
            value={feather}
            aria-label={t("selection.feather")}
            disabled={disabled}
            onChange={(event) => setFeather(Math.max(0, Math.min(MAX_FEATHER_RADIUS, Math.round(Number(event.target.value) || 0))))}
          />
          <Button variant="subtle" data-adp-selection-action="feather" disabled={disabled || busy} onClick={() => void apply({ kind: "feather", radius: feather })}>
            {t("selection.feather")}
          </Button>
        </div>
      </div>

      <p className="adp-selection-bounds" role="status">
        {props.selection.bounds
          ? t("selection.bounds", {
              width: props.selection.bounds.width,
              height: props.selection.bounds.height,
            })
          : t("selection.none")}
      </p>
      {busy ? <p className="adp-layer-working" role="status">{t("selection.working")}</p> : null}
      {error ? <p className="adp-layer-error" role="alert">{error}</p> : null}
    </section>
  );
}
