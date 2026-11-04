import { describe, expect, it } from "vitest";
import type { NaturalQueryRequest } from "../services/aiSearchTypes";
import {
  backendAfterFailure,
  embeddingsStayLocal,
  searchInferenceTask,
  sensitiveApiRefused,
} from "../services/aiSearch";

const request: NaturalQueryRequest = {
  text: "October PDFs",
  root_ids: ["11111111-1111-4111-8111-111111111111"],
  now_unix: 1_793_577_600,
  timezone: "UTC",
  locale: "en",
  request_revision: 1,
};

describe("AI search outbound policy", () => {
  it("ai_search_api_payload_gate", () => {
    const task = searchInferenceTask({ kind: "query", request });
    expect(task.prompt).not.toBeNull();
    expect(task.prompt?.output_schema_id).toBe("search.query.v1");
    expect(task.inputs).toEqual([]);
    expect(task.task).toBe("structured_text");
  });

  it("ai_search_api_changed_source", () => {
    const first = searchInferenceTask({ kind: "query", request });
    const second = searchInferenceTask({ kind: "query", request });
    expect(first.request_id).not.toBe(second.request_id);
  });

  it("ai_embeddings_never_api", () => {
    expect(embeddingsStayLocal()).toBe(true);
    expect(searchInferenceTask({ kind: "query", request }).task).toBe("structured_text");
  });

  it("ai_sensitive_api_refused", () => {
    expect(sensitiveApiRefused("api")).toBe(true);
    expect(sensitiveApiRefused("local")).toBe(false);
  });

  it("ai_search_no_fallback", () => {
    expect(backendAfterFailure("api", true)).toBeNull();
    expect(backendAfterFailure("local", true)).toBeNull();
    expect(backendAfterFailure("api", false)).toBe("api");
  });
});
