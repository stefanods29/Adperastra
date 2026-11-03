/** Trusted model helper entry (Step 07g T2/T6).
 *
 * The main app never imports this file. It receives one bounded helper
 * request, reads only application-issued grants, parses the model inside
 * this child process, and uploads either a SafeScene1 draft plus bounded
 * PNG textures or one 256 px thumbnail. No parent command is reachable. */

import {
  onHelperRequest,
  sendHelperReply,
  type HelperGrantDTO,
  type HelperAction,
  type HelperOutputReservation,
  type HelperReplyEnvelope,
  type HelperRequestEnvelope,
} from "../services/helperBridge";
import { loadModel, type TextureSlot } from "./loaders";
import { ModelResourceError, ModelResourcePolicy } from "./resources";
import { writeSafeScene } from "./safeSceneWriter";
import { uploadOutput } from "./upload";

interface ModelOpenPayload {
  grant_id: string;
  extension: string;
  resource_grants: Array<{ name: string; grant_id: string }>;
  /** Present only for the thumbnail provider. */
  thumbnail_edge?: number;
}

interface ModelReply {
  object_count: number;
  vertex_count: number;
  triangle_count: number;
  bounds: [number, number, number, number, number, number];
  unit: "none" | "mm" | "cm" | "m";
  partial: boolean;
  format: string;
  texture_output_ids: string[];
  thumbnail_output_id: string | null;
}

const MAX_SOURCE = 256 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 128 * 1024 * 1024;
const MAX_TEXTURES = 32;

function fail(code: string): never {
  throw new Error(code);
}

async function readGrant(grant: HelperGrantDTO): Promise<Uint8Array> {
  if (!Number.isSafeInteger(grant.byte_len) || grant.byte_len <= 0 || grant.byte_len > MAX_SOURCE) {
    fail("special_view.too_large");
  }
  const response = await fetch(grant.token_url, { cache: "no-store" });
  if (!response.ok) fail("special_view.unavailable");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== grant.byte_len) fail("special_view.changed");
  return new Uint8Array(buffer);
}

function describeImage(image: unknown): { width: number; height: number } | null {
  const value = image as { width?: unknown; height?: unknown; naturalWidth?: unknown; naturalHeight?: unknown };
  const width = typeof value.width === "number" ? value.width : typeof value.naturalWidth === "number" ? value.naturalWidth : 0;
  const height = typeof value.height === "number" ? value.height : typeof value.naturalHeight === "number" ? value.naturalHeight : 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (width * height > 16_000_000) return null;
  return { width, height };
}

async function encodePng(image: CanvasImageSource, width: number, height: number): Promise<Uint8Array> {
  const scale = Math.min(1, 4096 / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) fail("special_view.unsupported");
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) fail("special_view.unsupported");
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderThumbnail(root: unknown, edge: number): Promise<Uint8Array> {
  if (![256, 512, 1024].includes(edge)) fail("special_view.bad_request");
  const three = await import("three");
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(edge, edge, false);
  const scene = new three.Scene();
  scene.add(root as InstanceType<typeof three.Object3D>);
  const box = new three.Box3().setFromObject(root as InstanceType<typeof three.Object3D>);
  if (!box.isEmpty() && Number.isFinite(box.min.x) && Number.isFinite(box.max.x)) {
    const center = box.getCenter(new three.Vector3());
    const size = box.getSize(new three.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1e-6);
    const camera = new three.PerspectiveCamera(45, 1, radius / 1000, radius * 1000);
    camera.position.set(center.x + radius, center.y + radius, center.z + radius);
    camera.lookAt(center);
    scene.add(new three.AmbientLight(0xffffff, 1.2));
    const light = new three.DirectionalLight(0xffffff, 1.5);
    light.position.set(center.x + radius, center.y + radius * 2, center.z + radius);
    scene.add(light);
    renderer.render(scene, camera);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  renderer.dispose();
  if (!blob) fail("special_view.unsupported");
  return new Uint8Array(await blob.arrayBuffer());
}

function replyError(requestId: string, error: unknown): HelperReplyEnvelope<unknown> {
  const code = error instanceof Error ? error.message : "";
  const allowed = new Set([
    "special_view.bad_request",
    "special_view.unsupported",
    "special_view.too_large",
    "special_view.changed",
    "special_view.codec_required",
    "special_view.corrupt",
    "special_view.unavailable",
  ]);
  return {
    protocol_version: 1,
    request_id: requestId,
    status: "error",
    error_code: allowed.has(code) ? code : "special_view.corrupt",
  } as HelperReplyEnvelope<unknown>;
}

async function handleModel(request: HelperRequestEnvelope<ModelOpenPayload>, reservations: readonly HelperOutputReservation[]): Promise<HelperReplyEnvelope<ModelReply>> {
  if (request.action !== "model.open") fail("special_view.unsupported");
  const payload = request.payload;
  const grants = new Map(request.inputs.map((grant) => [grant.grant_id, grant]));
  const modelGrant = grants.get(payload.grant_id);
  if (!modelGrant) fail("special_view.bad_request");
  const bytes = await readGrant(modelGrant);
  const resourceGrants = payload.resource_grants.map((reference) => {
    const grant = grants.get(reference.grant_id);
    if (!grant) fail("special_view.bad_request");
    return { name: reference.name, url: grant.token_url, byte_len: grant.byte_len };
  });
  const policy = new ModelResourcePolicy(resourceGrants);

  const images: Array<{ image: CanvasImageSource; width: number; height: number }> = [];
  const textureSink = {
    add(image: unknown): number | null {
      if (images.length >= MAX_TEXTURES) return null;
      const size = describeImage(image);
      if (!size) return null;
      const index = images.length;
      images.push({ image: image as CanvasImageSource, ...size });
      return index;
    },
  };
  const loaded = await loadModel(bytes, payload.extension, policy, textureSink);
  const written = writeSafeScene({ roots: loaded.source, unit: loaded.unit });
  const summaries = { ...written.summary, partial: written.summary.partial || loaded.partial };

  if (payload.thumbnail_edge !== undefined) {
    const png = await renderThumbnail(loaded.root, payload.thumbnail_edge);
    const reservation = reservations[0];
    if (!reservation) fail("special_view.bad_request");
    const uploaded = await uploadOutput(reservation, png);
    return {
      protocol_version: 1,
      request_id: request.request_id,
      status: "ok",
      payload: {
        object_count: summaries.objectCount,
        vertex_count: summaries.vertexCount,
        triangle_count: summaries.triangleCount,
        bounds: summaries.bounds,
        unit: loaded.unit,
        partial: summaries.partial,
        format: payload.extension,
        texture_output_ids: [],
        thumbnail_output_id: uploaded.output_id,
      },
      outputs: [{ output_id: uploaded.output_id, mime: "image/png", byte_len: png.length, sha256: uploaded.sha256 }],
    } as HelperReplyEnvelope<ModelReply>;
  }

  const sceneReservation = reservations[0];
  if (!sceneReservation) fail("special_view.bad_request");
  const scene = await uploadOutput(sceneReservation, written.bytes);

  const slots: TextureSlot[] = [];
  let textureBytes = 0;
  const uploads: Array<{ output_id: string; mime: string; byte_len: number; sha256: string }> = [];
  for (let index = 0; index < images.length; index += 1) {
    const reservation = reservations[index + 1];
    if (!reservation) break;
    try {
      const png = await encodePng(images[index].image, images[index].width, images[index].height);
      textureBytes += png.length;
      if (textureBytes > MAX_TEXTURE_BYTES) break;
      const uploaded = await uploadOutput(reservation, png);
      slots.push({ index, width: images[index].width, height: images[index].height, png });
      uploads.push({ output_id: uploaded.output_id, mime: "image/png", byte_len: png.length, sha256: uploaded.sha256 });
    } catch {
      summaries.partial = true;
    }
  }

  return {
    protocol_version: 1,
    request_id: request.request_id,
    status: "ok",
    payload: {
      object_count: summaries.objectCount,
      vertex_count: summaries.vertexCount,
      triangle_count: summaries.triangleCount,
      bounds: summaries.bounds,
      unit: loaded.unit,
      partial: summaries.partial,
      format: payload.extension,
      texture_output_ids: uploads.map((output) => output.output_id),
      thumbnail_output_id: null,
    },
    outputs: [
      { output_id: scene.output_id, mime: "application/x-adperastra-scene", byte_len: written.bytes.length, sha256: scene.sha256 },
      ...uploads,
    ],
  } as HelperReplyEnvelope<ModelReply>;
}

async function start(): Promise<void> {
  await onHelperRequest<ModelOpenPayload>({ action: (value): value is HelperAction => value === "model.open", handler: async (request) => {
    try {
      if (request.action !== "model.open") fail("special_view.unsupported");
      const reservations = request.output_reservations ?? [];
      const reply = await handleModel(request, reservations);
      await sendHelperReply(reply);
    } catch (error) {
      await sendHelperReply(replyError(request.request_id, error));
    }
  }});
}

void start();
