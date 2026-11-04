import type { OfficeCapability, OfficeSessionState } from "./types";

/** Display gating only. Every mutation is authorized again by native code. */
export function canOfficeCommand(
  state: OfficeSessionState,
  capability: OfficeCapability,
  mutates: boolean,
): { enabled: boolean; reason_key: string | null } {
  if (!state.ready || state.busy || !state.capabilities.includes(capability)) {
    return { enabled: false, reason_key: "office.unsupported" };
  }
  if (capability === "save_copy" && state.compatibility?.blocks_save) {
    return { enabled: false, reason_key: "office.unsupported" };
  }
  if (mutates) {
    if (state.mode === "viewing") {
      return { enabled: false, reason_key: "office.enableEditing" };
    }
    if (state.mode === "reviewing" &&
        (state.family !== "document" ||
         (capability !== "document_review" && capability !== "document_text"))) {
      return { enabled: false, reason_key: "office.unsupported" };
    }
  }
  return { enabled: true, reason_key: null };
}
