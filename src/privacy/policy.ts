/** The one privacy policy resolver shared by Quick Convert, Details,
 * context menus and the cleaning dialog (Step 08c E4).
 *
 * It returns a fixed category list and never a vague "remove all". A saved
 * `remove` choice is explicit authorization only for a later user-started
 * action; this module never starts work by itself.
 */

import type { FormatId, MetadataCategory } from "../convert/types";
import {
  privacyFormatFor,
  supportedPrivacyCategories,
  type PrivacyMode,
  type PrivacySettings,
} from "../services/privacy";

export interface PrivacyPolicy {
  mode: PrivacyMode;
  /** The exact fixed categories; empty when mode is `keep`. */
  categories: MetadataCategory[];
}

export class PrivacyPolicyError extends Error {
  constructor(readonly code: "privacy.unsupported" | "privacy.bad_request") {
    super(code);
    this.name = "PrivacyPolicyError";
  }
}

function validateCategories(
  categories: readonly MetadataCategory[],
  supported: readonly MetadataCategory[],
): MetadataCategory[] {
  if (categories.length > 16) throw new PrivacyPolicyError("privacy.bad_request");
  const unique: MetadataCategory[] = [];
  for (const category of categories) {
    if (!supported.includes(category)) throw new PrivacyPolicyError("privacy.unsupported");
    if (!unique.includes(category)) unique.push(category);
  }
  return unique;
}

/**
 * Resolve the policy for one input format.
 *
 * `explicitCategories` (a user's reviewed dialog selection or an explicit
 * preset) wins over the saved defaults. An unsupported category is an error,
 * never silently dropped.
 */
export function privacyPolicyFor(
  settings: PrivacySettings,
  inputFormat: FormatId,
  explicitCategories?: readonly MetadataCategory[],
): PrivacyPolicy {
  const format = privacyFormatFor(inputFormat);
  if (!format) throw new PrivacyPolicyError("privacy.unsupported");
  const supported = supportedPrivacyCategories(format);
  if (explicitCategories !== undefined) {
    // An explicit empty review is a keep choice, never a reason to fall back
    // to a saved removal setting.
    if (explicitCategories.length === 0) return { mode: "keep", categories: [] };
    return {
      mode: "remove",
      categories: validateCategories(explicitCategories, supported),
    };
  }
  const mode = format === "pdf" ? settings.pdf_mode : settings.image_mode;
  if (mode === "keep") return { mode: "keep", categories: [] };
  const saved = format === "pdf" ? settings.pdf_categories : settings.image_categories;
  const categories = validateCategories(saved, supported);
  if (mode === "remove" && categories.length === 0) {
    // A saved remove choice with nothing selected removes nothing.
    return { mode: "keep", categories: [] };
  }
  return { mode, categories };
}

/** True when the policy can start cleaning without another explicit review. */
export function isAuthorizedRemoval(policy: PrivacyPolicy): boolean {
  return policy.mode === "remove" && policy.categories.length > 0;
}
