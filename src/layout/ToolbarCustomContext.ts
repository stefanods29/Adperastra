import { createContext, useContext } from "react";
import type { ToolbarCustomSettings } from "../services/commandLayout";

/** The saved toolbar layouts, for bars drawn outside the Explorer (viewer
 * ribbons). Without a provider every bar keeps its definition order. */
const ToolbarCustomSettingsContext = createContext<ToolbarCustomSettings | null>(null);

export const ToolbarCustomSettingsProvider = ToolbarCustomSettingsContext.Provider;

export function useToolbarCustomSettings(): ToolbarCustomSettings | null {
  return useContext(ToolbarCustomSettingsContext);
}
