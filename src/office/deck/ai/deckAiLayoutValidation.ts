import type { OfficeProposalPreview, OfficeProposalWarning } from "../../types";
import type { DeckStyle } from "../styles/styleTypes";
import {
  MIN_DECK_AI_TEXT_PT,
  MAX_DECK_AI_TEXT_PT,
  type DeckAiOutline,
  type DeckAiWarning,
} from "./deckAiTypes";

/** A5: minimum readable text is 16 pt (footer stays 10 pt) and layout text
 * never grows past the existing 96 pt cap to hide overflow. A real clone
 * overflow blocks acceptance; it is not acknowledged away. */

export function styleTextSizeValid(style: DeckStyle): boolean {
  return style.theme.layouts.every((layout) =>
    layout.placeholders.every(
      (placeholder) =>
        placeholder.role === "footer" ||
        (placeholder.text.size_pt >= MIN_DECK_AI_TEXT_PT && placeholder.text.size_pt <= MAX_DECK_AI_TEXT_PT),
    ),
  );
}

export function overflowPreview(preview: OfficeProposalPreview): boolean {
  return preview.warnings.some((warning) => warning.kind === "overflow") || !preview.can_apply;
}

export function proposalWarnings(preview: OfficeProposalPreview): DeckAiWarning[] {
  return preview.warnings.flatMap((warning: OfficeProposalWarning): DeckAiWarning[] => {
    switch (warning.kind) {
      case "overflow":
        return [
          {
            id: crypto.randomUUID(),
            kind: "overflow" as const,
            outline_id: null,
            source_id: warning.object_id,
            text_key: "deckAi.overflow",
            argument: warning.object_id,
            accepted: false as const,
          },
        ];
      case "unsupported":
        return [
          {
            id: crypto.randomUUID(),
            kind: "layout_unsupported" as const,
            outline_id: null,
            source_id: null,
            text_key: "deckAi.overflow",
            argument: warning.feature_id,
            accepted: false as const,
          },
        ];
      default:
        return [];
    }
  });
}

export function canAcceptPreview(preview: OfficeProposalPreview | null): boolean {
  return preview !== null && preview.can_apply && !preview.warnings.some((warning) => warning.kind === "overflow");
}

export function layoutKindsInOutline(outline: DeckAiOutline): string[] {
  return [...new Set(outline.slides.map((slide) => slide.layout_kind))];
}

export function layoutAvailable(style: DeckStyle, kind: string): boolean {
  return style.theme.layouts.some((layout) => layout.kind === kind);
}
