/** The window's layout (Step 05c), provided by App. */
import { createContext, useContext } from "react";
import { defaultSettings, type LayoutSettings } from "../services/settings";

export interface LayoutContextValue {
  layout: LayoutSettings;
  onLayoutChange: (layout: LayoutSettings) => void;
}

export const LayoutContext = createContext<LayoutContextValue>({
  layout: defaultSettings().layout,
  onLayoutChange: () => undefined,
});

/** The layout and the way to change it, from the nearest provider. */
export function useLayout(): LayoutContextValue {
  return useContext(LayoutContext);
}
