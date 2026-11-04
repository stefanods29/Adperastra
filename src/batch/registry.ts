import type { ConversionInput, ConversionReport } from "../convert/types";
import type { JobHandle } from "../services/jobs";
import type { PrivacyRequest } from "../services/privacy";

export type BatchActionOptions =
  | { kind: "convert_preset"; preset_id: string; dest_dir: string; naming_date_utc: string }
  | { kind: "privacy_clean"; request: PrivacyRequest };
export interface BatchActionSpec {
  id: "convert_preset" | "privacy_clean";
  label_key: string;
  accepts: (inputs: readonly ConversionInput[]) => boolean;
  run: (inputs: readonly ConversionInput[], options: BatchActionOptions) => Promise<JobHandle<ConversionReport>>;
}
const actions = new Map<string, BatchActionSpec>();

/** Static app registration only. No command IDs or callbacks come from data. */
export function registerBatchAction(spec: BatchActionSpec): void {
  if ((spec.id !== "convert_preset" && spec.id !== "privacy_clean") || actions.has(spec.id)) {
    throw new Error("rename.bad_request");
  }
  actions.set(spec.id, Object.freeze({ ...spec }));
}
export function resolveBatchAction(id: string): BatchActionSpec | null { return actions.get(id) ?? null; }
