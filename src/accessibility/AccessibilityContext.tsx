import { createContext, useContext, type ReactNode } from "react";
import type { EffectiveAccessibility } from "../services/accessibility";

/** The one effective-accessibility value for the tree (Step 10f E2). The
 * root resolves settings + Windows state into it; consumers never keep a
 * second local copy of the settings. */

const AccessibilityContext = createContext<EffectiveAccessibility | null>(null);

export interface AccessibilityProviderProps {
  value: EffectiveAccessibility;
  children: ReactNode;
}

export function AccessibilityProvider({ value, children }: AccessibilityProviderProps) {
  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility(): EffectiveAccessibility {
  const value = useContext(AccessibilityContext);
  if (value === null) {
    throw new Error("useAccessibility requires an AccessibilityProvider ancestor.");
  }
  return value;
}

/** For shared components that also render in standalone tests or previews:
 * null means "no provider", so the component keeps its neutral behavior.
 * Components inside the app still use `useAccessibility`. */
export function useAccessibilityOptional(): EffectiveAccessibility | null {
  return useContext(AccessibilityContext);
}

export default AccessibilityContext;
