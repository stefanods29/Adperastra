import type { OfficeFont } from "../../types";
import type { DeckStyle } from "./styleTypes";

/** Licensed Inter assets supplied by the approved 08b/13 font inventory.
 * The style data never downloads a font and never falls back to a Microsoft
 * family. A binary that the coordinator has not provisioned is unavailable. */

export const INTER_FONT_FAMILY = "Inter";
export const INTER_REGULAR_ASSET_ID = "inter-regular";
export const INTER_BOLD_ASSET_ID = "inter-bold";

export type DeckStyleFontAssetId = typeof INTER_REGULAR_ASSET_ID | typeof INTER_BOLD_ASSET_ID;

export interface DeckStyleFontAsset {
  asset_id: DeckStyleFontAssetId;
  family: typeof INTER_FONT_FAMILY;
  weight: 400 | 700;
  license: "OFL-1.1";
  /** Relative to the provisioned `assets/fonts/inter-4.1/` folder. */
  file_name: "Inter-Regular.ttf" | "Inter-Bold.ttf";
}

export const DECK_STYLE_FONT_ASSETS: readonly DeckStyleFontAsset[] = Object.freeze([
  {
    asset_id: INTER_REGULAR_ASSET_ID,
    family: INTER_FONT_FAMILY,
    weight: 400,
    license: "OFL-1.1",
    file_name: "Inter-Regular.ttf",
  },
  {
    asset_id: INTER_BOLD_ASSET_ID,
    family: INTER_FONT_FAMILY,
    weight: 700,
    license: "OFL-1.1",
    file_name: "Inter-Bold.ttf",
  },
]);

let availableAssetIds: ReadonlySet<string> = new Set<string>();

/** The coordinator calls this once from the approved font inventory. Until
 * then styles stay visible but Apply is disabled with a missing-font reason. */
export function registerAvailableDeckFontAssets(assetIds: readonly string[]): void {
  availableAssetIds = new Set(assetIds.filter((id) => (DECK_STYLE_FONT_ASSETS as readonly DeckStyleFontAsset[]).some((asset) => asset.asset_id === id)));
}

export function availableDeckFontAssets(): ReadonlySet<string> {
  return availableAssetIds;
}

export function isDeckFontAssetAvailable(assetId: string): boolean {
  return availableAssetIds.has(assetId);
}

/** Both assets a style needs. Two entries, so the card can name what is
 * missing instead of silently choosing another font. */
export function styleFontAssetIds(): readonly DeckStyleFontAssetId[] {
  return [INTER_REGULAR_ASSET_ID, INTER_BOLD_ASSET_ID];
}

export function missingDeckStyleFontAssets(style: DeckStyle): string[] {
  const families = new Set([
    style.theme.heading_font.family,
    style.theme.body_font.family,
  ]);
  if (families.size !== 1 || !families.has(INTER_FONT_FAMILY)) return [...families];
  return styleFontAssetIds().filter((assetId) => !isDeckFontAssetAvailable(assetId));
}

export function interOfficeFont(): OfficeFont {
  return { family: INTER_FONT_FAMILY, source: "bundled", embeddable: true };
}

export function deckStyleIsReadyToApply(style: DeckStyle): boolean {
  return missingDeckStyleFontAssets(style).length === 0;
}
