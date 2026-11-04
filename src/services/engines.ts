import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";
import type { EngineCapability } from "./engineTypes";

/**
 * Optional conversion engines (Step 12b E1).
 *
 * An engine is a pack the user installs from App storage. This service only
 * asks which capabilities the native side actually verified; it never starts
 * a process itself. Missing packs show the missing-pack card instead of a
 * half-working dialog (13/15/19/20a use the same call).
 */

/** Everything the native side audited for the installed engine packs. */
export async function engineCapabilities(): Promise<EngineCapability[]> {
  if (!isTauriRuntime()) return [];
  return (await invoke("engines_capabilities")) as EngineCapability[];
}

/** The capability record with this ID, or `null` when the engine never listed it. */
export function findCapability(
  capabilities: readonly EngineCapability[],
  id: string,
): EngineCapability | null {
  return capabilities.find((capability) => capability.id === id) ?? null;
}

/** True when the exact capability is usable now (available and no reason). */
export function capabilityAvailable(
  capabilities: readonly EngineCapability[],
  id: string,
): boolean {
  const capability = findCapability(capabilities, id);
  return capability !== null && capability.available && capability.reason === null;
}

/** Why a capability is unavailable, for the missing-pack card. */
export function capabilityReason(
  capabilities: readonly EngineCapability[],
  id: string,
): EngineCapability["reason"] {
  const capability = findCapability(capabilities, id);
  if (capability === null) return "packs_missing";
  return capability.reason;
}
