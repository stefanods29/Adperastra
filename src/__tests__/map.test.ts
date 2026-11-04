import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import "../i18n";
import type { SearchQuery } from "../services/search";
import {
  createMapTileSession,
  getMapTile,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  validateMapTileRequest,
  type MapTile,
} from "../services/mapTiles";
import {
  clampLatitude,
  latLonToWorld,
  MAX_MAP_LATITUDE,
  visibleTiles,
  worldToLatLon,
} from "../services/mapProjection";
import MapView from "../views/MapView";

const mockedInvoke = vi.mocked(invoke);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

beforeEach(() => {
  mockedInvoke.mockReset();
  localStorage.clear();
});

function emptyQuery(): SearchQuery {
  return {
    mode: "name",
    text: "",
    roots: [],
    filter: null,
    regex_scope: "name",
    match_case: false,
    sort: { key: "modified", direction: "descending" },
  };
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function tile(value: number): MapTile {
  return {
    lease: {
      lease_id: uuidFor(value),
      token: "0123456789abcdef0123456789abcdef",
      name: "tile.png",
      mime: "image/png",
      byte_len: 128,
      width: 256,
      height: 256,
    },
    cached: false,
    expires_unix: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    attribution: OSM_ATTRIBUTION,
  };
}

async function renderMap(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(MapView, {
        query: emptyQuery(),
        active: true,
        onOpenFile: () => undefined,
        onOpenHelp: () => undefined,
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("photo map", () => {
  it("disabled0network", async () => {
    await renderMap();
    const section = container?.querySelector(".adp-map");
    expect(section?.getAttribute("data-map-online")).toBe("false");
    const consent = container?.querySelector<HTMLInputElement>("[data-map-consent='online']");
    expect(consent?.checked).toBe(false);
    const commands = mockedInvoke.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("map_view_open");
    expect(commands).not.toContain("map_tile_get");
    expect(commands).toEqual([]);
  });

  it("lat0/lon0/z0=>128,128", () => {
    const world = latLonToWorld(0, 0, 0);
    expect(world.x).toBe(128);
    expect(world.y).toBe(128);
    const projected = visibleTiles({ latitude: 0, longitude: 0 }, 0, {
      width: 256,
      height: 256,
    });
    expect(projected).toEqual([{ z: 0, x: 0, y: 0 }]);
  });

  it("latitudeclamp", () => {
    expect(clampLatitude(90)).toBe(MAX_MAP_LATITUDE);
    expect(clampLatitude(-90)).toBe(-MAX_MAP_LATITUDE);
    expect(clampLatitude(Number.NaN)).toBe(0);
    const north = latLonToWorld(90, 0, 0);
    const south = latLonToWorld(-90, 0, 0);
    expect(north.y).toBeCloseTo(0, 6);
    expect(south.y).toBeCloseTo(256, 6);
    const back = worldToLatLon(128, 0, 0);
    expect(back.latitude).toBeCloseTo(MAX_MAP_LATITUDE, 6);
    expect(latLonToWorld(0, 180, 0).x).toBe(0);
  });

  it("invalidxydeny", async () => {
    expect(() => validateMapTileRequest({ zoom: 2, x: 4, y: 0 })).toThrow("map.invalid");
    expect(() => validateMapTileRequest({ zoom: 2, x: 0, y: 4 })).toThrow("map.invalid");
    expect(() => validateMapTileRequest({ zoom: 19, x: -1, y: 0 })).toThrow("map.invalid");
    expect(() => validateMapTileRequest({ zoom: 20, x: 0, y: 0 })).toThrow("map.invalid");
    expect(() => validateMapTileRequest({ zoom: 1.5, x: 0, y: 0 })).toThrow("map.invalid");
    await expect(getMapTile({ zoom: 2, x: 4, y: 0 })).rejects.toThrow("map.invalid");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("2requestsmax", async () => {
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    const load = vi.fn(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<MapTile>((resolve) => {
        const id = resolvers.length + 1;
        resolvers.push(() => {
          active -= 1;
          resolve(tile(id));
        });
      });
    });
    const release = vi.fn(async () => undefined);
    const session = createMapTileSession({ load, release });
    const first = session.load({ zoom: 1, x: 0, y: 0 });
    const second = session.load({ zoom: 1, x: 1, y: 0 });
    const third = session.load({ zoom: 1, x: 0, y: 1 });
    expect(load).toHaveBeenCalledTimes(2);
    resolvers[0]();
    await first;
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(2);
    resolvers[1]();
    resolvers[2]();
    await Promise.all([second, third]);
    await session.close();
  });

  it("closeabort", async () => {
    const resolvers: Array<() => void> = [];
    const load = vi.fn(() => {
      return new Promise<MapTile>((resolve) => {
        const id = resolvers.length + 1;
        resolvers.push(() => resolve(tile(id)));
      });
    });
    const release = vi.fn(async () => undefined);
    const session = createMapTileSession({ load, release });
    const first = session.load({ zoom: 1, x: 0, y: 0 });
    const second = session.load({ zoom: 1, x: 1, y: 0 });
    const third = session.load({ zoom: 1, x: 0, y: 1 });
    const queued = expect(third).rejects.toThrow("map.unavailable");
    const closing = session.close();
    await queued;
    resolvers[0]();
    resolvers[1]();
    await expect(first).rejects.toThrow("map.unavailable");
    await expect(second).rejects.toThrow("map.unavailable");
    await closing;
    expect(release).toHaveBeenCalledTimes(2);
    await expect(session.load({ zoom: 1, x: 0, y: 0 })).rejects.toThrow("map.unavailable");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("attributionalwaysvisible", async () => {
    await renderMap();
    const link = container?.querySelector<HTMLAnchorElement>(".adp-map-attribution");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(OSM_COPYRIGHT_URL);
    expect(link?.textContent).toContain("OpenStreetMap");
    const canvas = container?.querySelector(".adp-map-canvas");
    expect(canvas).not.toBeNull();
  });
});
