import type { DeckAiOutline } from "./deckAiTypes";

/** A8: names, numbers, dates and URLs are protected source facts. A generated
 * text that loses or changes one is a draft fact warning, never a silent
 * rewrite. Comparison is deliberately exact for the token, not semantic. */

export interface ProtectedFact {
  kind: "number" | "date" | "url";
  value: string;
  start: number;
  end: number;
}

const PATTERNS: { kind: ProtectedFact["kind"]; pattern: RegExp }[] = [
  { kind: "url", pattern: /https?:\/\/[^\s<>"']+/giu },
  { kind: "date", pattern: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gu },
  {
    kind: "number",
    pattern: /\b\d+(?:[.,]\d+)?\s?(?:%|MiB|GiB|MB|GB|ms|s|min|minutes?|hours?|days?|users?|files?|PEN|USD|EUR)?\b/gu,
  },
];

export function extractProtectedFacts(text: string): ProtectedFact[] {
  const facts: ProtectedFact[] = [];
  for (const { kind, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const value = match[0].trim();
      if (!value) continue;
      facts.push({ kind, value, start: match.index, end: match.index + match[0].length });
    }
  }
  return facts.sort((left, right) => left.start - right.start);
}

export function outlineText(outline: DeckAiOutline): string {
  const parts: string[] = [];
  for (const slide of outline.slides) {
    parts.push(slide.title, ...slide.bullets, ...slide.right_bullets, slide.caption, slide.quote, slide.speaker_notes);
  }
  for (const choice of outline.layout_choices) parts.push(choice.rationale);
  parts.push(outline.rationale);
  return parts.join("\n");
}

export function missingProtectedFacts(source: string, generated: string): string[] {
  const sourceFacts = extractProtectedFacts(source);
  const generatedFacts = new Set(extractProtectedFacts(generated).map((fact) => fact.value));
  return sourceFacts.filter((fact) => !generatedFacts.has(fact.value)).map((fact) => fact.value);
}

export function protectedFactRatio(source: string, generated: string): number {
  const sourceFacts = extractProtectedFacts(source);
  if (sourceFacts.length === 0) return 1;
  const generatedFacts = new Set(extractProtectedFacts(generated).map((fact) => fact.value));
  return sourceFacts.filter((fact) => generatedFacts.has(fact.value)).length / sourceFacts.length;
}

export function assertProtectedFacts(source: string, outline: DeckAiOutline): void {
  if (missingProtectedFacts(source, outlineText(outline)).length > 0) {
    throw new Error("deck_ai.changed");
  }
}
