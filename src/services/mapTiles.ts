import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import type { FileIdentityKey } from "./fileIdentity";
import { fileUrl } from "./files";
import type { JobHandle } from "./jobs";
import { runJob } from "./jobs";
import type { SearchQuery } from "./search";
import { loadSettings, saveSettings } from "./settings";
import type { ViewsSettings } from "./smartViews";

/** Photo map service (Step 11b E6, decisions 9-11).
 *
 * Only this module talks to the native map commands. Tiles are binary files
 * leased through the `adpfile` protocol; nothing here builds a remote URL for
 * an `<img>` and no host can be supplied by the UI. */

/** Mirrors Rust `map_types::GeoPoint` (snake_case wire fields). */
export interface GeoPoint {
  key: FileIdentityKey;
  path: string;
  source: SourceStamp;
  latitude: number;
  longitude: number;
  date_unix?: number | null;
}

/** Mirrors Rust `map_types::GeoPointPage`. */
export interface GeoPointPage {
  points: GeoPoint[];
  next_cursor?: string | null;
  complete: boolean;
  skipped_count: number;
  generation: number;
}

/** Mirrors Rust `map_types::MapTileRequest`; zoom 0-19 and x/y below 2^zoom. */
export interface MapTileRequest {
  zoom: number;
  x: number;
  y: number;
}

/** Mirrors Rust `map_types::MapTileLease`. The token belongs to FileGrants. */
export interface MapTileLease {
  lease_id: string;
  token: string;
  name: string;
  mime: string;
  byte_len: number;
  width: number;
  height: number;
}

/** Mirrors Rust `map_types::MapTile`. There is no URL: only a local lease. */
export interface MapTile {
  lease: MapTileLease;
  cached: boolean;
  expires_unix: number;
  attribution: string;
}

export const OSM_TILE_URL = "https://tile.openstreetmap.org";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const MAP_TILE_SIZE = 256;
export const MIN_MAP_ZOOM = 0;
export const MAX_MAP_ZOOM = 19;
export const MAX_VISIBLE_TILES = 64;
export const MAX_CONCURRENT_TILE_REQUESTS = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidMapTileRequest(request: MapTileRequest): boolean {
  const { zoom, x, y } = request;
  if (!Number.isInteger(zoom) || zoom < MIN_MAP_ZOOM || zoom > MAX_MAP_ZOOM) return false;
  const limit = 2 ** zoom;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < limit && y < limit;
}

/** Reject an impossible tile before any invoke; the native check repeats it. */
export function validateMapTileRequest(request: MapTileRequest): void {
  if (!isValidMapTileRequest(request)) throw new Error("map.invalid");
}

/** Indexed geo points of the current search. Native reads indexed local photo
 * metadata only; online-only photos are skipped before their properties. */
export async function geoPoints(
  query: SearchQuery,
  cursor?: string | null,
): Promise<JobHandle<GeoPointPage>> {
  if (cursor != null && !UUID_RE.test(cursor)) throw new Error("map.invalid");
  return runJob<GeoPointPage>("mapgeo", (requestId) =>
    invoke("geo_points_start", { requestId, query, cursor: cursor ?? null }),
  );
}

/** One visible tile, from the local cache or the fixed OSM endpoint. */
export async function getMapTile(request: MapTileRequest): Promise<MapTile> {
  validateMapTileRequest(request);
  return (await invoke("map_tile_get", { request })) as MapTile;
}

/** Release one tile lease. The bytes stay in the local cache. */
export async function releaseMapTile(leaseId: string): Promise<void> {
  if (!UUID_RE.test(leaseId)) throw new Error("map.invalid");
  await invoke("map_tile_release", { leaseId });
}

/** Open the single map-view lease required by every tile request. Rejects
 * with `map.disabled` while the explicit online setting is off. */
export async function openMapView(): Promise<string> {
  return (await invoke("map_view_open")) as string;
}

/** Close the map-view lease; native releases every tile lease it still holds. */
export async function closeMapView(viewId: string): Promise<void> {
  if (!UUID_RE.test(viewId)) throw new Error("map.invalid");
  await invoke("map_view_close", { viewId });
}

/** Explicit user action: remove cached tiles and every outstanding lease. */
export async function clearMapTileCache(): Promise<void> {
  await invoke("map_tile_clear");
}

/** The only URL a tile image may use: a granted local lease. */
export function mapTileUrl(token: string): string {
  return fileUrl(token, "tile.png");
}

/** The persisted "uses internet" consent, off by default. */
export async function getMapOnlineEnabled(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.views.map_online_enabled;
}

/** Persist the explicit consent; returns the stored value. */
export async function setMapOnlineEnabled(enabled: boolean): Promise<boolean> {
  const settings = await loadSettings();
  const views: ViewsSettings = { ...settings.views, map_online_enabled: enabled };
  const saved = await saveSettings({ ...settings, views });
  return saved.views.map_online_enabled;
}

// ---------------------------------------------------------------------------
// Bounded tile session
// ---------------------------------------------------------------------------

export interface MapTileSession {
  load(request: MapTileRequest): Promise<MapTile>;
  release(leaseId: string): Promise<void>;
  close(): Promise<void>;
}

export interface MapTileSessionOptions {
  load?: (request: MapTileRequest) => Promise<MapTile>;
  release?: (leaseId: string) => Promise<void>;
  concurrency?: number;
}

interface QueuedLoad {
  request: MapTileRequest;
  resolve: (tile: MapTile) => void;
  reject: (error: unknown) => void;
}

/** At most two tile requests at once; a third waits. Closing rejects queued
 * loads, waits for in-flight ones and releases every lease they produced, so
 * no token outlives the view. */
export function createMapTileSession(options: MapTileSessionOptions = {}): MapTileSession {
  const loadTile = options.load ?? getMapTile;
  const releaseTile = options.release ?? releaseMapTile;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? MAX_CONCURRENT_TILE_REQUESTS, MAX_CONCURRENT_TILE_REQUESTS),
  );
  let closed = false;
  let active = 0;
  const queue: QueuedLoad[] = [];
  const leases = new Set<string>();
  const running = new Set<Promise<void>>();

  const drain = (): void => {
    while (!closed && active < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      active += 1;
      const work = (async () => {
        try {
          const tile = await loadTile(next.request);
          if (closed) {
            await releaseTile(tile.lease.lease_id).catch(() => undefined);
            next.reject(new Error("map.unavailable"));
            return;
          }
          leases.add(tile.lease.lease_id);
          next.resolve(tile);
        } catch (reason) {
          next.reject(reason);
        } finally {
          active -= 1;
          drain();
        }
      })();
      running.add(work);
      void work.finally(() => running.delete(work));
    }
  };

  return {
    load(request) {
      try {
        validateMapTileRequest(request);
      } catch (reason) {
        return Promise.reject(reason);
      }
      if (closed) return Promise.reject(new Error("map.unavailable"));
      return new Promise<MapTile>((resolve, reject) => {
        queue.push({ request, resolve, reject });
        drain();
      });
    },
    async release(leaseId) {
      leases.delete(leaseId);
      await releaseTile(leaseId);
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const waiting of queue.splice(0)) waiting.reject(new Error("map.unavailable"));
      await Promise.allSettled([...running]);
      const remaining = [...leases];
      leases.clear();
      await Promise.allSettled(remaining.map((leaseId) => releaseTile(leaseId)));
    },
  };
}
