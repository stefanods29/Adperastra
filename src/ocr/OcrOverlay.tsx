import { useMemo, type ClipboardEvent, type CSSProperties } from "react";
import type { OcrPage } from "../services/ocr";
import {
  isFiniteOcrBox,
  ocrBoxToSource,
  ocrSourceToView,
  type OcrBox,
} from "./ocrCoordinates";
import { collectSelectedText, orderedWords } from "./ocrSelection";

/** OCR text overlay (Step 07e export E3).
 *
 * Inert, absolutely positioned word boxes over the image or rendered PDF
 * page. The text is escaped React text: it can be selected and copied, but
 * it is never markup and never a focus stop. The parent owns the source and
 * the conversion to the viewport; the overlay never opens a file.
 */
export interface OcrOverlayProps {
  result: OcrPage;
  /** Displayed view box after rotation, in CSS pixels. */
  viewWidth: number;
  viewHeight: number;
  rotation: 0 | 90 | 180 | 270;
  /** 1 = 100 %. */
  zoom: number;
  /** Escaped, reading-order selected text (the copy event already put it
   * on the plain-text clipboard). No write callback exists here. */
  onSelectionText: (text: string) => void;
  /** Ordered word indexes of the current Find match. */
  highlight?: readonly number[];
}

interface PlacedWord {
  text: string;
  index: number;
  box: OcrBox;
}

function placeWords(
  result: OcrPage,
  viewWidth: number,
  viewHeight: number,
  rotation: 0 | 90 | 180 | 270,
  zoom: number,
): PlacedWord[] {
  const ordered = orderedWords(result.words);
  const placed: PlacedWord[] = [];
  ordered.forEach((word, index) => {
    try {
      const source = ocrBoxToSource(
        { x: word.x, y: word.y, width: word.width, height: word.height },
        result.recognized_width,
        result.recognized_height,
        result.original_width,
        result.original_height,
      );
      const box = ocrSourceToView(
        source,
        result.original_width,
        result.original_height,
        viewWidth,
        viewHeight,
        rotation,
        zoom,
      );
      if (isFiniteOcrBox(box) && box.width > 0 && box.height > 0) {
        placed.push({ text: word.text, index, box });
      }
    } catch {
      // A malformed word is skipped; the rest of the page stays usable.
    }
  });
  return placed;
}

export function OcrOverlay({
  result,
  viewWidth,
  viewHeight,
  rotation,
  zoom,
  onSelectionText,
  highlight = [],
}: OcrOverlayProps) {
  const placed = useMemo(
    () => placeWords(result, viewWidth, viewHeight, rotation, zoom),
    [result, viewWidth, viewHeight, rotation, zoom],
  );

  const handleCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = collectSelectedText(event.currentTarget, result.words, window.getSelection());
    if (!text) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    onSelectionText(text);
  };

  return (
    <div
      className="adp-ocr-overlay"
      style={{ width: viewWidth, height: viewHeight }}
      onCopy={handleCopy}
    >
      {placed.map(({ text, index, box }) => {
        const style: CSSProperties = {
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          fontSize: `${Math.max(1, box.height * 0.8)}px`,
        };
        return (
          <span
            key={`${index}-${text.slice(0, 8)}`}
            className={`adp-ocr-word${highlight.includes(index) ? " adp-ocr-word--match" : ""}`}
            data-adp-ocr-index={index}
            style={style}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}

export default OcrOverlay;
