import { createContext, useContext, type ReactNode } from "react";
import type { UndoEntry, UndoStack } from "../services/undo";
import type { TrackJob } from "../views/explorer/JobsPanel";

/** What Quick Convert needs from the Explorer (Step 08a T6/T7). The
 * coordinator provides this once around the app; the dialog never reaches
 * into ExplorerHome or the undo stack directly. */
export interface ConversionEnvironment {
  trackJob: TrackJob;
  notify: (message: string) => void;
  notifyAction: (message: string, entry: UndoEntry | null) => void;
  notifyError: (error: unknown, area: string) => void;
  undoStack: UndoStack;
  touchUndo: () => void;
  currentFolder: () => string | null;
  /** Select the new items and go to the destination when asked. */
  showResult: (destDir: string, select: string | null, navigate: boolean) => void;
}

const ConversionEnvironmentContext = createContext<ConversionEnvironment | null>(null);

export function ConversionProvider({
  value,
  children,
}: {
  value: ConversionEnvironment;
  children: ReactNode;
}) {
  return (
    <ConversionEnvironmentContext.Provider value={value}>
      {children}
    </ConversionEnvironmentContext.Provider>
  );
}

export function useConversionEnvironment(): ConversionEnvironment | null {
  return useContext(ConversionEnvironmentContext);
}
