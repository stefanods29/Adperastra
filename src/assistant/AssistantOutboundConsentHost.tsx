import { useEffect, useRef, useState } from "react";
import { confirmAssistantOutbound } from "../services/assistantInference";
import { AssistantOutboundDialog } from "./AssistantOutboundDialog";
import { assistantErrorKey, type AssistantOutboundPreview } from "./types";

export interface AssistantOutboundConsentHostProps {
  preview: AssistantOutboundPreview;
  onConsent(consentId: string): void;
  onCancel(): void;
  /** Stable translation key, for callers that report the refusal. */
  onError?(errorKey: string): void;
}

/**
 * Shared outbound-consent host (Step 17a).
 *
 * It shows the exact prepared payload through `AssistantOutboundDialog` and is
 * the only caller of `assistant_outbound_confirm` in this flow. The native
 * confirmation is requested once: after a success or a refusal the Send
 * control stays disabled, so a replay needs a fresh native prepare and a new
 * human review. Neither the preview nor the consent is stored.
 */
export function AssistantOutboundConsentHost({
  preview,
  onConsent,
  onCancel,
  onError,
}: AssistantOutboundConsentHostProps) {
  const [phase, setPhase] = useState<"idle" | "confirming" | "settled">("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    inFlight.current = false;
    settled.current = false;
    setPhase("idle");
    setErrorKey(null);
  }, [preview.preview_id]);

  const send = async () => {
    if (inFlight.current || settled.current) return;
    if (
      !Number.isFinite(preview.expires_unix) ||
      Math.floor(Date.now() / 1000) >= preview.expires_unix
    ) {
      settled.current = true;
      setPhase("settled");
      setErrorKey("errors.assistant.outbound_expired");
      onError?.("errors.assistant.outbound_expired");
      return;
    }
    inFlight.current = true;
    setPhase("confirming");
    setErrorKey(null);
    try {
      const result = await confirmAssistantOutbound(preview.preview_id);
      if (!result || typeof result.consent_id !== "string" || result.consent_id.length === 0) {
        throw new Error("assistant.outbound_required");
      }
      settled.current = true;
      setPhase("settled");
      onConsent(result.consent_id);
    } catch (caught) {
      const code =
        caught instanceof Error ? caught.message : typeof caught === "string" ? caught : null;
      const key = assistantErrorKey(code);
      settled.current = true;
      setPhase("settled");
      setErrorKey(key);
      onError?.(key);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <AssistantOutboundDialog
      preview={preview}
      busy={phase === "confirming"}
      settled={phase === "settled"}
      errorKey={errorKey}
      onSend={() => void send()}
      onCancel={onCancel}
    />
  );
}

export default AssistantOutboundConsentHost;
