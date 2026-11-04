import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listReadVoices,
  readSpeechChunk,
  scalarCount,
  startReadAloud,
  stopReadAloud,
  validateReadAloudRequest,
} from "../services/readAloud";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
const TOKEN = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("read aloud requests", () => {
  it("counts scalars and bounds text to 100000", () => {
    expect(scalarCount("a".repeat(1001))).toBe(1001);
    expect(() =>
      validateReadAloudRequest({ text: "x".repeat(100001), sensitive: false }),
    ).toThrow("read_aloud.invalid");
    expect(() => validateReadAloudRequest({ text: "", sensitive: false })).toThrow(
      "read_aloud.invalid",
    );
  });

  it("treats SSML as plain text, never as markup", async () => {
    invokeMock.mockResolvedValue({
      session_id: SESSION_ID,
      chunk_count: 1,
      next_sequence: 0,
      state: "preparing",
    });
    const session = await startReadAloud({ text: "<speak>hello</speak>", sensitive: false });
    expect(session.chunk_count).toBe(1);
    const sent = invokeMock.mock.calls[0][1] as { request: { text: string } };
    expect(sent.request.text).toBe("<speak>hello</speak>");
  });

  it("passes the document capture identity through unchanged", async () => {
    invokeMock.mockResolvedValue({
      session_id: SESSION_ID,
      chunk_count: 2,
      next_sequence: 0,
      state: "preparing",
    });
    await startReadAloud({
      text: "body",
      document_id: SESSION_ID,
      source_revision: 41,
      sensitive: true,
    });
    const sent = invokeMock.mock.calls[0][1] as {
      request: { document_id: string; source_revision: number };
    };
    expect(sent.request.document_id).toBe(SESSION_ID);
    expect(sent.request.source_revision).toBe(41);
  });
});

describe("read aloud voices and chunks", () => {
  it("lists only installed local voices", async () => {
    invokeMock.mockResolvedValue([
      { id: "voice-1", name: "Microsoft voice", language: "en-US", local: true },
    ]);
    await expect(listReadVoices()).resolves.toHaveLength(1);
    invokeMock.mockResolvedValue([{ id: "v", name: "Cloud", language: "en", local: false }]);
    await expect(listReadVoices()).rejects.toThrow("read_aloud.failed");
  });

  it("refuses oversized chunk metadata before any grant is used", async () => {
    invokeMock.mockResolvedValue({
      session_id: SESSION_ID,
      sequence: 0,
      token: TOKEN,
      name: "speech.wav",
      mime: "audio/wav",
      byte_len: 32 * 1024 * 1024 + 1,
      end: false,
    });
    await expect(readSpeechChunk(SESSION_ID, 0)).rejects.toThrow("read_aloud.too_large");
  });

  it("returns bounded chunk metadata for playback", async () => {
    invokeMock.mockResolvedValue({
      session_id: SESSION_ID,
      sequence: 0,
      token: TOKEN,
      name: "speech.wav",
      mime: "audio/wav",
      byte_len: 128,
      end: true,
    });
    const chunk = await readSpeechChunk(SESSION_ID, 0);
    expect(chunk.name).toBe("speech.wav");
    expect(chunk.end).toBe(true);
  });

  it("stop validates the session and revokes through one call", async () => {
    invokeMock.mockResolvedValue(undefined);
    await stopReadAloud(SESSION_ID);
    expect(invokeMock).toHaveBeenCalledWith("read_aloud_stop", { sessionId: SESSION_ID });
    await expect(stopReadAloud("not-a-session")).rejects.toThrow("read_aloud.invalid");
  });
});
