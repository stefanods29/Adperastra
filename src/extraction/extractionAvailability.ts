import type { AssistantBackend } from "../assistant/types";
import { assistantEndpointStatus, credentialStatus } from "../services/assistantProviders";
import { aiCapabilities } from "../services/localAiRuntime";
import { loadSettings, type AppSettings } from "../services/settings";

/** Whether this build can honestly start extraction (Step 17d T8).
 *
 * Local extraction requires a ready structured-text/vision pack; an API
 * backend requires an explicit provider configuration and still goes through
 * the one-shot outbound review. Without either, no OCR/layout job starts and
 * no receipt or table is invented in the web view.
 */

export type ExtractionUnavailableReason = "disabled" | "pack_missing" | "api_unavailable";

export interface ExtractionAvailability {
  available: boolean;
  backend: AssistantBackend;
  reason: ExtractionUnavailableReason | null;
}

function unavailable(
  backend: AssistantBackend,
  reason: ExtractionUnavailableReason,
): ExtractionAvailability {
  return { available: false, backend, reason };
}

export async function extractionAvailability(): Promise<ExtractionAvailability> {
  let settings: AppSettings;
  try {
    settings = await loadSettings();
  } catch {
    return unavailable("local", "disabled");
  }
  const backend = settings.assistant.backend;
  if (!settings.assistant.enabled) return unavailable(backend, "disabled");
  if (backend === "api") {
    try {
      const configured =
        settings.assistant.provider_id === "custom_compatible"
          ? (await assistantEndpointStatus()).configured
          : (await credentialStatus("meta")).has_key;
      return configured
        ? { available: true, backend, reason: null }
        : unavailable(backend, "api_unavailable");
    } catch {
      return unavailable(backend, "api_unavailable");
    }
  }
  try {
    const rows = await aiCapabilities();
    const ready = rows.some(
      (row) =>
        (row.task === "structured_text" || row.task === "vision_answer") && row.available,
    );
    return ready ? { available: true, backend, reason: null } : unavailable(backend, "pack_missing");
  } catch {
    return unavailable(backend, "pack_missing");
  }
}
