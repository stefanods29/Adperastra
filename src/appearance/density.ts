/** Row sizes for the density setting (Step 05d). */
import { createContext, useContext } from "react";
import type { Density } from "../services/settings";

/** The height of a Details or Column view row, and of a List view item. */
export const ROW_SIZES: Record<Density, { row: number; listItem: number }> = {
  compact: { row: 24, listItem: 20 },
  comfortable: { row: 28, listItem: 24 },
  spacious: { row: 36, listItem: 30 },
};

/** The density every list draws with; App provides the chosen one. */
export const AppearanceContext = createContext<Density>("comfortable");

/** The row sizes of the density around this component. */
export function useRowSizes(): { row: number; listItem: number } {
  return ROW_SIZES[useContext(AppearanceContext)];
}
