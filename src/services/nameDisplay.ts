/** Grapheme-safe file-name display helpers (Step 10c T3, display-formats-1).
 *
 * File names are truncated for display only. The stored name, sorting and
 * type detection never change. Every limit below counts grapheme clusters,
 * so an emoji family or an accented letter is never split in half.
 */

export interface SplitName {
  /** The name without its final extension. */
  base: string;
  /** The final extension including its leading dot, or "". */
  extension: string;
}

let segmenter: Intl.Segmenter | null | undefined;

/** Split text into user-perceived characters (grapheme clusters). */
export function splitGraphemes(text: string): string[] {
  if (segmenter === undefined) {
    try {
      segmenter =
        typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
          ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
          : null;
    } catch {
      segmenter = null;
    }
  }
  if (segmenter !== null) {
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/** Split the last `.ext` from a name. A leading dot (".gitignore") is not
 * an extension, and a trailing dot is part of the base. */
export function splitFinalExtension(name: string): SplitName {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, extension: "" };
  return { base: name.slice(0, dot), extension: name.slice(dot) };
}

/** Keep the first `limit` graphemes and mark the cut with an ellipsis. */
export function truncateEnd(text: string, limit: number): string {
  const units = splitGraphemes(text);
  if (limit <= 0) return "";
  if (units.length <= limit) return text;
  if (limit === 1) return "…";
  return units.slice(0, limit - 1).join("") + "…";
}

/** Keep both ends and put the ellipsis in the middle. */
export function truncateMiddleText(text: string, limit: number): string {
  const units = splitGraphemes(text);
  if (limit <= 0) return "";
  if (units.length <= limit) return text;
  if (limit === 1) return "…";
  const available = limit - 1;
  const headCount = Math.ceil(available / 2);
  const tailCount = available - headCount;
  return units.slice(0, headCount).join("") + "…" + units.slice(units.length - tailCount).join("");
}

/**
 * Truncate a file name. In `middle` mode the final extension stays visible
 * when `keepExtension` is true; the remaining budget is split evenly, with
 * the head getting the extra grapheme.
 */
export function truncateFileName(
  name: string,
  limit: number,
  mode: "middle" | "end",
  keepExtension: boolean,
): string {
  if (limit <= 0) return "";
  const units = splitGraphemes(name);
  if (units.length <= limit) return name;

  const { base, extension } = splitFinalExtension(name);
  const extensionUnits = splitGraphemes(extension);

  if (mode === "end") {
    if (keepExtension && extensionUnits.length > 0 && extensionUnits.length < limit) {
      const baseBudget = limit - extensionUnits.length - 1;
      if (baseBudget >= 1) {
        const baseUnits = splitGraphemes(base);
        return baseUnits.slice(0, baseBudget).join("") + "…" + extension;
      }
    }
    return truncateEnd(name, limit);
  }

  if (!keepExtension || extensionUnits.length === 0 || extensionUnits.length >= limit - 1) {
    return truncateMiddleText(name, limit);
  }
  const budget = limit - extensionUnits.length - 1;
  if (budget < 2) return truncateEnd(name, limit);
  const headCount = Math.ceil(budget / 2);
  const tailCount = budget - headCount;
  const baseUnits = splitGraphemes(base);
  if (headCount + tailCount >= baseUnits.length) return name;
  return (
    baseUnits.slice(0, headCount).join("") +
    "…" +
    baseUnits.slice(baseUnits.length - tailCount).join("") +
    extension
  );
}
