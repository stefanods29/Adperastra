import type { SelectionRect } from "../selectionGeometry";
export function SelectionBand({ rect }: { rect: SelectionRect | null }) {
  return rect ? <div aria-hidden="true" className="adp-selection-band" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} /> : null;
}
export default SelectionBand;
