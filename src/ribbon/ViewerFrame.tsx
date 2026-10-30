import type { ReactNode } from "react";
import ToolbarDock from "../layout/ToolbarDock";

/** A viewer's ribbon and content (Step 04b). Step 05c docks the ribbon on
 * the side the layout chooses (`ToolbarDock`). */
export default function ViewerFrame({ ribbon, children }: { ribbon: ReactNode; children: ReactNode }) {
  return (
    <div className="adp-viewer">
      <ToolbarDock toolbar={ribbon} contentClassName="adp-viewer-content">
        {children}
      </ToolbarDock>
    </div>
  );
}
