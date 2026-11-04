import type { GeoPoint } from "./mapTiles";

/** App-owned Web Mercator projection for the photo map (Step 11b decision
 * 10). No map library, no geocoding: only the fixed slippy-tile formula. */

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface MapViewport {
  width: number;
  height: number;
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

export interface GeoCluster {
  id: string;
  x: number;
  y: number;
  count: number;
  latitude: number;
  longitude: number;
  points: GeoPoint[];
}

export const MAP_TILE_SIZE = 256;
export const MIN_MAP_ZOOM = 0;
export const MAX_MAP_ZOOM = 19;
export const MAX_MAP_LATITUDE = 85.05112878;
export const MAX_VISIBLE_TILES = 64;
export const MAP_CLUSTER_PX = 48;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_MAP_ZOOM;
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(zoom)));
}

export function clampLatitude(latitude: number): number {
  if (!Number.isFinite(latitude)) return 0;
  return Math.max(-MAX_MAP_LATITUDE, Math.min(MAX_MAP_LATITUDE, latitude));
}

/** Wrap a longitude into [-180, 180). */
export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return 0;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

export function worldSize(zoom: number): number {
  return MAP_TILE_SIZE * 2 ** clampZoom(zoom);
}

/** x = (lon + 180) / 360 * 256 * 2^z, y in world pixels of the same size. */
export function latLonToWorld(latitude: number, longitude: number, zoom: number): WorldPoint {
  const size = worldSize(zoom);
  const lat = clampLatitude(latitude);
  const lon = normalizeLongitude(longitude);
  const x = ((lon + 180) / 360) * size;
  const phi = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size;
  return { x, y };
}

export function worldToLatLon(x: number, y: number, zoom: number): LatLon {
  const size = worldSize(zoom);
  const wrappedX = ((x % size) + size) % size;
  const clampedY = Math.max(0, Math.min(size, y));
  const longitude = (wrappedX / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * clampedY) / size;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude: clampLatitude(latitude), longitude: normalizeLongitude(longitude) };
}

export function tileKey(tile: TileRef): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function viewportSize(viewport: MapViewport): MapViewport {
  return {
    width: Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 1,
    height: Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 1,
  };
}

function wrappedWorldX(tileX: number, zoom: number, centerWorldX: number): number {
  const size = worldSize(zoom);
  const tileCenter = tileX * MAP_TILE_SIZE + MAP_TILE_SIZE / 2;
  const shift = Math.round((tileCenter - centerWorldX) / size) * size;
  return tileCenter - shift;
}

/** Screen position of a tile's top-left corner, choosing the wrapped copy
 * nearest the viewport so panning across the date line stays seamless. */
export function tileScreenPosition(
  tile: TileRef,
  center: LatLon,
  viewport: MapViewport,
): WorldPoint {
  const size = viewportSize(viewport);
  const centerWorld = latLonToWorld(center.latitude, center.longitude, tile.z);
  const centerX = wrappedWorldX(tile.x, tile.z, centerWorld.x);
  return {
    x: centerX - MAP_TILE_SIZE / 2 - (centerWorld.x - size.width / 2),
    y: tile.y * MAP_TILE_SIZE - (centerWorld.y - size.height / 2),
  };
}

/** Visible tiles for one viewport: wrap x, clamp y, at most 64, nearest
 * first when a huge viewport would need more. */
export function visibleTiles(
  center: LatLon,
  zoom: number,
  viewport: MapViewport,
): TileRef[] {
  const z = clampZoom(zoom);
  const size = viewportSize(viewport);
  const world = worldSize(z);
  const count = 2 ** z;
  const centerWorld = latLonToWorld(center.latitude, center.longitude, z);
  const width = Math.min(size.width, world);
  const height = Math.min(size.height, world);
  const left = centerWorld.x - width / 2;
  const top = centerWorld.y - height / 2;
  const firstX = Math.floor(left / MAP_TILE_SIZE);
  const lastX = Math.floor((left + width - 0.001) / MAP_TILE_SIZE);
  const firstY = Math.max(0, Math.floor(top / MAP_TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((top + height - 0.001) / MAP_TILE_SIZE));
  const tiles: TileRef[] = [];
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      tiles.push({ z, x: ((x % count) + count) % count, y });
    }
  }
  if (tiles.length <= MAX_VISIBLE_TILES) return tiles;
  const middleX = size.width / 2;
  const middleY = size.height / 2;
  const distance = (tile: TileRef): number => {
    const point = tileScreenPosition(tile, center, size);
    return (point.x + MAP_TILE_SIZE / 2 - middleX) ** 2 + (point.y + MAP_TILE_SIZE / 2 - middleY) ** 2;
  };
  return tiles
    .sort((leftTile, rightTile) => distance(leftTile) - distance(rightTile))
    .slice(0, MAX_VISIBLE_TILES)
    .sort((leftTile, rightTile) => leftTile.y - rightTile.y || leftTile.x - rightTile.x);
}

/** Screen position of one geographic point in the viewport. */
export function projectGeoPoint(
  point: LatLon,
  zoom: number,
  center: LatLon,
  viewport: MapViewport,
): WorldPoint {
  const size = viewportSize(viewport);
  const z = clampZoom(zoom);
  const world = latLonToWorld(point.latitude, point.longitude, z);
  const centerWorld = latLonToWorld(center.latitude, center.longitude, z);
  const worldWidth = worldSize(z);
  const unwrapped = world.x + Math.round((centerWorld.x - world.x) / worldWidth) * worldWidth;
  return {
    x: unwrapped - (centerWorld.x - size.width / 2),
    y: world.y - (centerWorld.y - size.height / 2),
  };
}

function pointId(point: GeoPoint): string {
  return `${point.key.volume_id}:${point.key.file_id}:${point.key.path_key}`;
}

/** Grid clusters of 48 CSS px aligned to the world grid, so a cluster keeps
 * its identity while the viewport pans at one zoom level. */
export function clusterGeoPoints(
  points: readonly GeoPoint[],
  zoom: number,
  center: LatLon,
  viewport: MapViewport,
  cellPx = MAP_CLUSTER_PX,
): GeoCluster[] {
  const z = clampZoom(zoom);
  const cell = Math.max(1, Math.round(cellPx));
  const groups = new Map<string, { points: GeoPoint[]; x: number; y: number }>();
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    const world = latLonToWorld(point.latitude, point.longitude, z);
    const cellX = Math.floor(world.x / cell);
    const cellY = Math.floor(world.y / cell);
    const id = `${z}:${cellX}:${cellY}`;
    const screen = projectGeoPoint(point, z, center, viewport);
    const group = groups.get(id);
    if (group) {
      group.points.push(point);
      group.x += screen.x;
      group.y += screen.y;
    } else {
      groups.set(id, { points: [point], x: screen.x, y: screen.y });
    }
  }
  return [...groups.entries()]
    .map(([id, group]) => {
      const count = group.points.length;
      const latitude =
        group.points.reduce((sum, point) => sum + point.latitude, 0) / count;
      const longitude =
        group.points.reduce((sum, point) => sum + point.longitude, 0) / count;
      return {
        id,
        x: group.x / count,
        y: group.y / count,
        count,
        latitude,
        longitude,
        points: group.points.sort((left, right) => pointId(left).localeCompare(pointId(right))),
      };
    })
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
}
