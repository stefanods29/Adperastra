import { invoke } from "@tauri-apps/api/core";
import type {
  AssistantConnectionResult,
  AssistantEndpointStatus,
  AssistantModel,
  AssistantProviderId,
  CredentialStatus,
} from "../assistant/types";

/**
 * Provider and credential transport (Step 17a T4, E8).
 *
 * These calls happen only from an explicit UI action. A key edit opens a
 * native password editor; no function here accepts or returns a secret.
 */

export async function credentialStatus(
  providerId: AssistantProviderId,
): Promise<CredentialStatus> {
  return (await invoke("assistant_credential_status", { providerId })) as CredentialStatus;
}

export async function editAssistantCredential(
  providerId: AssistantProviderId,
): Promise<CredentialStatus> {
  return (await invoke("assistant_credential_edit", { providerId })) as CredentialStatus;
}

export async function removeAssistantCredential(
  providerId: AssistantProviderId,
): Promise<CredentialStatus> {
  return (await invoke("assistant_credential_remove", { providerId })) as CredentialStatus;
}

export async function listAssistantModels(
  providerId: AssistantProviderId,
): Promise<AssistantModel[]> {
  return (await invoke("assistant_provider_models", { providerId })) as AssistantModel[];
}

export async function testAssistantProvider(
  providerId: AssistantProviderId,
): Promise<AssistantConnectionResult> {
  return (await invoke("assistant_provider_test", { providerId })) as AssistantConnectionResult;
}

export async function configureAssistantEndpoint(
  baseUrl: string,
  modelId: string,
): Promise<AssistantEndpointStatus> {
  return (await invoke("assistant_endpoint_configure", {
    baseUrl,
    modelId,
  })) as AssistantEndpointStatus;
}

export async function assistantEndpointStatus(): Promise<AssistantEndpointStatus> {
  return (await invoke("assistant_endpoint_status")) as AssistantEndpointStatus;
}

/**
 * Additive custom-endpoint probe required by the guide's separate "Test
 * structured response" / "Test image support" clicks. The frozen E8 table
 * names no probe function, so this wrapper is a coordinator-owned extension
 * proposal (see handoff section 3); it never runs automatically.
 */
export async function probeAssistantEndpoint(
  endpointId: string,
  probe: "models" | "structured" | "vision",
): Promise<AssistantConnectionResult> {
  return (await invoke("assistant_endpoint_probe", {
    endpointId,
    probe,
  })) as AssistantConnectionResult;
}
