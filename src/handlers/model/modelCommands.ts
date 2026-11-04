import { Focus, Network, Ruler } from "lucide-react";
import type { Command } from "../../commands/registry";

export interface ModelCommandContext {
  hasModel: boolean;
  wireframe: boolean;
  measuring: boolean;
}

export interface ModelCommandActions {
  fit: () => void;
  toggleWireframe: () => void;
  toggleMeasure: () => void;
}

/** Local model commands (Step 07g D4). IDs are the contract names; no
 * global shortcut is added. */
export function createModelCommands(actions: ModelCommandActions): Command<ModelCommandContext>[] {
  return [
    {
      id: "model.fit",
      labelKey: "model.fit",
      icon: Focus,
      risk: "read-only",
      helpSlug: "viewing-3d-models",
      enabledWhen: (context) => context.hasModel,
      run: () => actions.fit(),
    },
    {
      id: "model.wireframe",
      labelKey: "model.wireframe",
      icon: Network,
      risk: "read-only",
      helpSlug: "viewing-3d-models",
      checkKind: "toggle",
      checkedWhen: (context) => context.wireframe,
      enabledWhen: (context) => context.hasModel,
      run: () => actions.toggleWireframe(),
    },
    {
      id: "model.measure",
      labelKey: "model.measure",
      icon: Ruler,
      risk: "read-only",
      helpSlug: "viewing-3d-models",
      checkKind: "toggle",
      checkedWhen: (context) => context.measuring,
      enabledWhen: (context) => context.hasModel,
      run: () => actions.toggleMeasure(),
    },
  ];
}
