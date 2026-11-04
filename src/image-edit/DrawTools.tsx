import { ArrowUpRight, Brush, Eraser, Highlighter, PenLine, Shapes, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";

/** Draw tool rail (D8). Buttons are keyboard reachable and each has a stable
 * translated aria-label; the rail itself is 48 px wide. */

export type DrawTool = "brush" | "pen" | "highlighter" | "eraser" | "shapes" | "arrow" | "text";

interface ToolDefinition {
  id: DrawTool;
  labelKey: string;
  icon: LucideIcon;
}

const TOOLS: readonly ToolDefinition[] = [
  { id: "brush", labelKey: "imageEdit.brush", icon: Brush },
  { id: "pen", labelKey: "imageEdit.pen", icon: PenLine },
  { id: "highlighter", labelKey: "imageEdit.highlighter", icon: Highlighter },
  { id: "eraser", labelKey: "imageEdit.erase", icon: Eraser },
  { id: "shapes", labelKey: "imageEdit.shapes", icon: Shapes },
  { id: "arrow", labelKey: "imageEdit.arrow", icon: ArrowUpRight },
  { id: "text", labelKey: "imageEdit.text", icon: Type },
];

export interface DrawToolsProps {
  tool: DrawTool;
  onTool: (tool: DrawTool) => void;
  disabled?: boolean;
}

export default function DrawTools({ tool, onTool, disabled }: DrawToolsProps) {
  const { t } = useTranslation();
  return (
    <div className="adp-image-rail" role="toolbar" aria-orientation="vertical" aria-label={t("imageEdit.draw")}>
      {TOOLS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="adp-image-rail-btn"
          data-adp-image-tool={id}
          aria-label={t(labelKey)}
          aria-pressed={tool === id}
          disabled={disabled}
          onClick={() => onTool(id)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export { TOOLS as DRAW_TOOLS };
