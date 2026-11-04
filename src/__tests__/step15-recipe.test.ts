import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { createMediaEditorController } from "../media-edit/MediaDocument";
import type { MediaRecipe, MediaSource } from "../media-edit/types";
import { MEDIA_EDIT_MIME, mediaRecipeBytes } from "../media-edit/types";
import {
  createRecipeSaveCopyRequest,
  decodeRecipeDocument,
  encodeRecipeDocument,
  recipeIsDirty,
  relinkMediaSource,
} from "../media-edit/recipeCodec";
import { assertMediaExportable } from "../services/mediaEdit";
import {
  appendExportSnapshot,
  authorizeNewSnapshot,
  beginExportSnapshot,
  finishExportSnapshot,
} from "../services/exportSnapshots";

vi.mock("../services/exportSnapshots", () => ({
  authorizeNewSnapshot: vi.fn(),
  beginExportSnapshot: vi.fn(),
  appendExportSnapshot: vi.fn(),
  finishExportSnapshot: vi.fn(),
  releaseExportSnapshot: vi.fn(async () => undefined),
}));

const initialContentId = "33333333-3333-4333-8333-333333333333";

function source(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    path: "C:\\media\\sample.mp4",
    stamp: {
      path_key: "C:\\media\\sample.mp4",
      volume_id: "00000000",
      file_id: "0000000000000001",
      modified_ticks: "100",
      size_bytes: 4096,
    },
    duration_us: 10_000_000,
    video_rate: { num: 30, den: 1 },
    audio_rate: 48_000,
    sensitive: false,
    ...overrides,
  };
}

function recipe(): MediaRecipe {
  return {
    schema_version: 1,
    project_id: "22222222-2222-4222-8222-222222222222",
    content_id: initialContentId,
    sources: [source()],
    segments: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        source_id: "11111111-1111-4111-8111-111111111111",
        start_us: 0,
        end_us: 10_000_000,
        speed: 1,
      },
    ],
    crop: null,
    rotation: 0,
    volume: 1,
    mute: false,
    keep_pitch: true,
    subtitles: [],
    subtitle_mode: "off",
    metadata_keep: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recipe documents", () => {
  it("round-trips exact TimeUs through the document codec", () => {
    const original = recipe();
    original.segments[0] = { ...original.segments[0], start_us: 1_000_001, end_us: 9_999_999 };
    const document = encodeRecipeDocument(original);
    const decoded = decodeRecipeDocument(document.bytes);
    expect(decoded.segments[0].start_us).toBe(1_000_001);
    expect(decoded.segments[0].end_us).toBe(9_999_999);
    expect(decoded.content_id).toBe(initialContentId);
    expect(document.bytes.byteLength).toBe(mediaRecipeBytes(original).byteLength);
  });

  it("Save copy never marks the recipe clean", () => {
    const original = recipe();
    const edited = {
      ...original,
      content_id: "77777777-7777-4777-8777-777777777777",
      segments: [{ ...original.segments[0], end_us: 4_000_000 }],
    };
    const snapshot = {
      snapshot_id: "88888888-8888-4888-8888-888888888888",
      document_id: original.project_id,
      revision: 2,
      content_id: edited.content_id,
      mime: MEDIA_EDIT_MIME,
      byte_len: 10,
      source: null,
      storage_policy: "ordinary",
      expires_unix: 1,
    } as unknown as ExportSnapshot;
    const request = createRecipeSaveCopyRequest(original.project_id, snapshot, edited, "C:\\out\\copy.admedia");
    expect(request.mode).toBe("copy");
    expect(request.dest_path).toBe("C:\\out\\copy.admedia");
    expect(recipeIsDirty(edited, initialContentId)).toBe(true);
    expect(edited.content_id).not.toBe(initialContentId);
  });

  it("relink keeps every edit and refuses a short source", () => {
    const original = recipe();
    original.segments[0] = { ...original.segments[0], start_us: 1_000_000, end_us: 9_000_000, speed: 2 };
    original.subtitles = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        start_us: 1_500_000,
        end_us: 2_500_000,
        text: "Año",
      },
    ];
    original.subtitle_mode = "select";
    const replacement = source({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      path: "D:\\media\\moved.mp4",
      duration_us: 12_000_000,
      stamp: { ...source().stamp, path_key: "D:\\media\\moved.mp4", file_id: "0000000000000002" },
    });
    const result = relinkMediaSource(original, original.sources[0].id, replacement);
    expect(result.changed).toBe(true);
    expect(result.recipe.sources[0].id).toBe(original.sources[0].id);
    expect(result.recipe.sources[0].path).toBe("D:\\media\\moved.mp4");
    expect(result.recipe.segments).toEqual(original.segments);
    expect(result.recipe.subtitles).toEqual(original.subtitles);
    expect(result.recipe.volume).toBe(original.volume);

    const short = source({ path: "D:\\media\\short.mp4", duration_us: 1_000_000 });
    expect(() => relinkMediaSource(original, original.sources[0].id, short)).toThrow(
      "media_edit.unsupported",
    );
  });

  it("a sensitive replacement or source is refused before export", () => {
    const sensitive = { ...source(), sensitive: true } as unknown as MediaSource;
    const original = { ...recipe(), sources: [sensitive] };
    expect(() => assertMediaExportable(original)).toThrow("media_edit.unsupported");
    expect(() =>
      relinkMediaSource(recipe(), recipe().sources[0].id, { ...source(), sensitive: true } as unknown as MediaSource),
    ).toThrow("media_edit.unsupported");
  });
});

describe("recipe capture", () => {
  it("freezes the requested revision and content id before encoding", async () => {
    let releaseBegin: (value: { snapshot_id: string; upload_token: string }) => void = () => undefined;
    const beginPromise = new Promise<{ snapshot_id: string; upload_token: string }>((resolve) => {
      releaseBegin = resolve;
    });
    vi.mocked(authorizeNewSnapshot).mockResolvedValue({
      document_id: "doc-1",
      name: "recipe",
      mime: MEDIA_EDIT_MIME,
      storage_policy: "ordinary",
    } as never);
    vi.mocked(beginExportSnapshot).mockReturnValue(beginPromise as never);
    let uploaded = 0;
    vi.mocked(appendExportSnapshot).mockImplementation(async (_id, _token, _offset, bytes) => {
      uploaded += bytes.byteLength;
    });
    vi.mocked(finishExportSnapshot).mockImplementation(async () =>
      ({
        snapshot_id: "snap-1",
        document_id: "doc-1",
        revision: 1,
        content_id: initialContentId,
        mime: MEDIA_EDIT_MIME,
        byte_len: uploaded,
        source: null,
        storage_policy: "ordinary",
        expires_unix: 1,
      }) as never,
    );

    const controller = createMediaEditorController(recipe());
    const capture = controller.capture(1, initialContentId);
    await controller.apply({
      kind: "set_segments",
      segments: [{ ...recipe().segments[0], end_us: 4_000_000 }],
    });
    releaseBegin({ snapshot_id: "snap-1", upload_token: "0123456789abcdef0123456789abcdef" });
    const snapshot = await capture;
    expect(snapshot.revision).toBe(1);
    expect(snapshot.content_id).toBe(initialContentId);
    expect(controller.getRecipe().content_id).not.toBe(initialContentId);
    expect(controller.isDirty()).toBe(true);
  });

  it("requires the registered recipe MIME", async () => {
    vi.mocked(authorizeNewSnapshot).mockResolvedValue({
      document_id: "doc-1",
      name: "recipe",
      mime: "text/plain",
      storage_policy: "ordinary",
    } as never);
    const controller = createMediaEditorController(recipe());
    await expect(controller.capture(1, initialContentId)).rejects.toThrow("media_edit.unsupported");
    expect(vi.mocked(authorizeNewSnapshot).mock.calls[0][1]).toBe(MEDIA_EDIT_MIME);
  });
});
