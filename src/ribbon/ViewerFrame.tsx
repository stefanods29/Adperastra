import type { ReactNode } from "react";

/** A viewer's ribbon and content (Step 04b). The ribbon is on top; Step
 * 05c lets the layout put it on any side, by changing only this file. */
export default function ViewerFrame({ ribbon, children }: { ribbon: ReactNode; children: ReactNode }) {
  return (
    <div className="adp-viewer">
      {ribbon}
      <div className="adp-viewer-content">{children}</div>
    </div>
  );
}
