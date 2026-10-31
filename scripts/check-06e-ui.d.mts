/** Types for the scoped 06e review runner (scripts/check-06e-ui.mjs). */

export interface ReviewScope {
  port: string;
  demo: string;
  output: string;
  shots: string;
  language: "en" | "es" | "pseudo";
  theme: "light" | "dark";
}

export function validateReviewScope(argv: string[]): ReviewScope;
