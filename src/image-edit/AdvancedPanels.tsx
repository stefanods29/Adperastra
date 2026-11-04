import { useTranslation } from "react-i18next";
import IconButton from "../components/IconButton";
import { isCommandEnabled, type Command } from "../commands/registry";
import type { DocumentHandle } from "../documents/types";
import LayersPanel from "./LayersPanel";
import SelectionTools from "./SelectionTools";
import type { AdvancedCommandContext } from "./advancedCommands";
import type { LayerSelectionState } from "./layerTypes";
import type { SelectionMask, SelectionMode, SelectionOperation, SelectionTool } from "./selectionTypes";
import type { ImageController } from "./types";

/** Step 18a Advanced presenter: the existing 300 px right side hosts the
 * shared command bar, selection tools and Layers panel. The command list is
 * registered once by ImageEditor; this component never defines a second one. */

export interface AdvancedActions {
  addLayer: () => void;
  duplicateLayer: () => void;
  deleteLayer: () => void;
  mergeLayer: () => void;
  flattenLayer: () => void;
  invertSelection: () => void;
  toggleAdvanced: () => void;
}

export interface AdvancedPanelsProps {
  document: DocumentHandle;
  controller: ImageController;
  commands: readonly Command<AdvancedCommandContext>[];
  ctx: AdvancedCommandContext;
  state: LayerSelectionState;
  onStateChange: (state: LayerSelectionState) => void;
  selection: SelectionMask;
  onSelection: (operation: SelectionOperation) => Promise<void>;
  mode: SelectionMode;
  onMode: (mode: SelectionMode) => void;
  tolerance: number;
  onTolerance: (tolerance: number) => void;
  disabled: boolean;
}

export default function AdvancedPanels(props: AdvancedPanelsProps) {
  const { t } = useTranslation();
  const { state } = props;

  const chooseTool = (tool: SelectionTool) => {
    props.onStateChange({ ...state, tool });
  };

  return (
    <div className="adp-advanced-side" data-adp-advanced-side="true">
      <div className="adp-advanced-commandbar" role="toolbar" aria-label={t("layers.title")}>
        {props.commands
          .filter((command) => command.id !== "image.advanced")
          .map((command) => (
            <IconButton
              key={command.id}
              icon={command.icon}
              labelKey={command.labelKey}
              disabled={!isCommandEnabled(command, props.ctx)}
              onClick={() => command.run(props.ctx)}
            />
          ))}
      </div>
      <SelectionTools
        selection={props.selection}
        tool={state.tool}
        onTool={chooseTool}
        onApply={props.onSelection}
        mode={props.mode}
        onModeChange={props.onMode}
        tolerance={props.tolerance}
        onToleranceChange={props.onTolerance}
        disabled={props.disabled || state.viewonly}
      />
      <LayersPanel
        document={props.document}
        controller={props.controller}
        state={state}
        onStateChange={props.onStateChange}
      />
    </div>
  );
}
