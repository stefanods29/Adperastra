import { beforeEach, describe, expect, it, vi } from "vitest";
import { startTransfer } from "../services/transferJobs";
import type { AiDestination, AiSortSuggestion, SortHistory } from "../services/aiSearchTypes";
import {
  chipVisible,
  moveWithSuggestion,
  rankedDestinations,
  suggestDestinationFromHistory,
} from "../organize/sortSuggestionAdapter";

vi.mock("../services/transferJobs", () => ({
  startTransfer: vi.fn(async () => ({
    id: "move",
    cancel: async () => undefined,
    completion: Promise.resolve({
      report_id: "r",
      items: [],
      done: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
      job_finished: true,
      complete: true,
      replace_available: false,
    }),
  })),
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const destination = (id: string, path: string): AiDestination => ({ id, path, name: path });

const history: SortHistory = {
  schema_version: 1,
  revision: 1,
  counts: [{ extension: "jpg", destination_id: A, count: 4 }],
  disabled: [],
};

const suggestion: AiSortSuggestion = {
  id: "44444444-4444-4444-8444-444444444444",
  identity: {
    volume_id: "00000001",
    file_id: "0000000000000001",
    path_key: "c:\\photos\\beach.jpg",
    stable: true,
  },
  source_stamp: {
    path_key: "c:\\photos\\beach.jpg",
    volume_id: "00000001",
    file_id: "0000000000000001",
    modified_ticks: "133000000000000000",
    size_bytes: 10,
  },
  destination_id: B,
  score: 0.9,
  basis: "history",
  reason: "history",
  extension: "jpg",
  expires_unix: 2_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("destination suggestions", () => {
  it("sort_history_score", () => {
    const destinations = [destination(A, "C:\\A"), destination(B, "C:\\B")];
    const ranked = rankedDestinations(history, "jpg", destinations);
    expect(ranked.map((entry) => entry.destination.id)).toEqual([A]);
    expect(ranked[0].score).toBeCloseTo(5 / 6, 9);
    expect(suggestDestinationFromHistory(history, "jpg", destinations)?.id).toBe(A);
  });

  it("sort_history_minimum", () => {
    const short = { ...history, counts: [{ extension: "jpg", destination_id: A, count: 2 }] };
    expect(
      suggestDestinationFromHistory(short, "jpg", [destination(A, "C:\\A"), destination(B, "C:\\B")]),
    ).toBeNull();
  });

  it("sort_destination_deleted", async () => {
    await expect(
      moveWithSuggestion({
        suggestion,
        sourcePath: "C:\\Photos\\beach.jpg",
        sourceStamp: suggestion.source_stamp,
        destinations: [destination(A, "C:\\A")],
      }),
    ).rejects.toThrow("ai_search.denied");
    expect(startTransfer).not.toHaveBeenCalled();
  });

  it("sort_never_kind", () => {
    const optedOut = { ...history, disabled: ["pdf"] };
    expect(rankedDestinations(optedOut, "pdf", [destination(A, "C:\\A")])).toEqual([]);
    expect(rankedDestinations(optedOut, "jpg", [destination(A, "C:\\A")])).toHaveLength(1);
  });

  it("sort_no_automatic_move", async () => {
    const chosen = suggestDestinationFromHistory(history, "jpg", [
      destination(A, "C:\\A"),
      destination(B, "C:\\B"),
    ]);
    expect(chosen?.id).toBe(A);
    expect(chipVisible(suggestion, false, false)).toBe(true);
    expect(startTransfer).not.toHaveBeenCalled();

    await moveWithSuggestion({ suggestion, sourcePath: "C:\\Photos\\beach.jpg", sourceStamp: suggestion.source_stamp, destinations: [destination(B, "C:\\B")] });
    expect(startTransfer).toHaveBeenCalledTimes(1);
    expect(startTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "move",
        dest_dir: "C:\\B",
        expected_sources: [suggestion.source_stamp],
        allow_system: false,
      }),
    );
  });
});
