import type { TFunction } from "i18next";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import { errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import {
  clearMapTileCache,
  closeMapView,
  createMapTileSession,
  geoPoints,
  getMapOnlineEnabled,
  mapTileUrl,
  openMapView,
  OSM_COPYRIGHT_URL,
  setMapOnlineEnabled,
  type GeoPoint,
  type GeoPointPage,
  type MapTile,
  type MapTileSession,
} from "../services/mapTiles";
import {
  clampZoom,
  clusterGeoPoints,
  latLonToWorld,
  tileKey,
  tileScreenPosition,
  visibleTiles,
  worldToLatLon,
  type GeoCluster,
  type LatLon,
  type MapViewport,
  type TileRef,
} from "../services/mapProjection";
import type { SearchQuery } from "../services/search";

export interface MapViewProps {
  query: SearchQuery;
  active: boolean;
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
}

const DEFAULT_CENTER: LatLon = { latitude: 20, longitude: 0 };
const DEFAULT_ZOOM = 2;
const PAN_STEP_PX = 64;

function displayName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function pointId(point: GeoPoint): string {
  return `${point.key.volume_id}:${point.key.file_id}:${point.key.path_key}`;
}

function parseTileKey(key: string): TileRef | null {
  const parts = key.split("/").map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) return null;
  return { z: parts[0], x: parts[1], y: parts[2] };
}

function tileErrorText(t: TFunction, code: string): string {
  if (code === "map.limit") return t("map.tileLimit");
  if (code === "map.disabled") return t("errors.map.disabled");
  if (code === "map.invalid") return t("errors.map.invalid");
  return t("errors.map.unavailable");
}

/** The optional photo map (Step 11b E6, decisions 9-11). Photos and GPS are
 * local; only map tiles use the internet, after an explicit opt-in. */
export default function MapView({ query, active, onOpenFile, onOpenHelp }: MapViewProps) {
  const { t, i18n } = useTranslation();
  const [online, setOnline] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [skipped, setSkipped] = useState(0);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [center, setCenter] = useState<LatLon>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [viewport, setViewport] = useState<MapViewport>({ width: 640, height: 360 });
  const [tiles, setTiles] = useState<Map<string, MapTile>>(() => new Map());
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<MapTileSession | null>(null);
  const tilesRef = useRef(tiles);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    void getMapOnlineEnabled()
      .then((enabled) => {
        if (!cancelled) setOnline(enabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const measure = () =>
      setViewport({
        width: element.clientWidth || 640,
        height: element.clientHeight || 360,
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let handle: JobHandle<GeoPointPage> | null = null;
    setGeoLoading(true);
    setGeoError(null);
    setPoints([]);
    geoPoints(query)
      .then((started) => {
        handle = started;
        if (disposed) {
          void started.cancel();
          return;
        }
        return started.completion.then((page) => {
          if (disposed) return;
          setPoints(page.points);
          setCursor(page.next_cursor ?? null);
          setComplete(page.complete);
          setSkipped(page.skipped_count);
        });
      })
      .catch((reason: unknown) => {
        if (!disposed) setGeoError(typeof reason === "string" ? reason : "map.unavailable");
      })
      .finally(() => {
        if (!disposed) setGeoLoading(false);
      });
    return () => {
      disposed = true;
      void handle?.cancel();
    };
  }, [active, queryKey, revision]);

  useEffect(() => {
    if (!active || !online) return;
    let disposed = false;
    let opened: string | null = null;
    const session = createMapTileSession();
    sessionRef.current = session;
    setViewReady(false);
    setTileError(null);
    openMapView()
      .then((viewId) => {
        opened = viewId;
        if (disposed) {
          void closeMapView(viewId).catch(() => undefined);
          return;
        }
        setViewReady(true);
      })
      .catch((reason: unknown) => {
        if (!disposed) setTileError(typeof reason === "string" ? reason : "map.unavailable");
      });
    return () => {
      disposed = true;
      setViewReady(false);
      sessionRef.current = null;
      void session.close();
      if (opened) void closeMapView(opened).catch(() => undefined);
    };
  }, [active, online]);

  useEffect(() => {
    if (online) return;
    const empty = new Map<string, MapTile>();
    tilesRef.current = empty;
    setTiles(empty);
    setTileError(null);
  }, [online]);

  useEffect(() => {
    if (!active || !online || !viewReady) return;
    const session = sessionRef.current;
    if (!session) return;
    let disposed = false;
    const wanted = visibleTiles(center, zoom, viewport);
    const wantedKeys = new Set(wanted.map(tileKey));
    let changed = false;
    const next = new Map(tilesRef.current);
    for (const [key, loaded] of next) {
      if (!wantedKeys.has(key)) {
        next.delete(key);
        changed = true;
        void session.release(loaded.lease.lease_id).catch(() => undefined);
      }
    }
    if (changed) {
      tilesRef.current = next;
      setTiles(next);
    }
    for (const tile of wanted) {
      const key = tileKey(tile);
      if (tilesRef.current.has(key)) continue;
      void session
        .load({ zoom: tile.z, x: tile.x, y: tile.y })
        .then((loaded) => {
          if (disposed) {
            void session.release(loaded.lease.lease_id).catch(() => undefined);
            return;
          }
          if (tilesRef.current.has(key)) return;
          const after = new Map(tilesRef.current);
          after.set(key, loaded);
          tilesRef.current = after;
          setTiles(after);
          setTileError(null);
        })
        .catch((reason: unknown) => {
          if (!disposed) setTileError(typeof reason === "string" ? reason : "map.unavailable");
        });
    }
    return () => {
      disposed = true;
    };
  }, [
    active,
    online,
    viewReady,
    center.latitude,
    center.longitude,
    zoom,
    viewport.width,
    viewport.height,
  ]);

  useEffect(() => {
    if (!active) return;
    return () => {
      const empty = new Map<string, MapTile>();
      tilesRef.current = empty;
      setTiles(empty);
    };
  }, [active]);

  const clusters = useMemo(
    () => clusterGeoPoints(points, zoom, center, viewport),
    [points, zoom, center.latitude, center.longitude, viewport.width, viewport.height],
  );

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }),
    [i18n.language],
  );

  const loadMore = async () => {
    if (!cursor || geoLoading) return;
    setGeoLoading(true);
    setGeoError(null);
    try {
      const started = await geoPoints(query, cursor);
      const page = await started.completion;
      setPoints((current) => [...current, ...page.points]);
      setCursor(page.next_cursor ?? null);
      setComplete(page.complete);
      setSkipped(page.skipped_count);
    } catch (reason) {
      setGeoError(typeof reason === "string" ? reason : "map.unavailable");
    } finally {
      setGeoLoading(false);
    }
  };

  const toggleConsent = async (enabled: boolean) => {
    if (consentBusy) return;
    setConsentBusy(true);
    setTileError(null);
    try {
      const stored = await setMapOnlineEnabled(enabled);
      setOnline(stored);
    } catch {
      setOnline(false);
      setTileError("map.unavailable");
    } finally {
      setConsentBusy(false);
    }
  };

  const clearCache = async () => {
    if (cacheBusy) return;
    setCacheBusy(true);
    setTileError(null);
    try {
      await clearMapTileCache();
      const empty = new Map<string, MapTile>();
      tilesRef.current = empty;
      setTiles(empty);
    } catch (reason) {
      setTileError(typeof reason === "string" ? reason : "map.unavailable");
    } finally {
      setCacheBusy(false);
    }
  };

  const pan = (dx: number, dy: number) => {
    setCenter((current) => {
      const world = latLonToWorld(current.latitude, current.longitude, zoom);
      return worldToLatLon(world.x + dx, world.y + dy, zoom);
    });
  };

  const changeZoom = (delta: number) => setZoom((current) => clampZoom(current + delta));

  const zoomToCluster = (cluster: GeoCluster) => {
    setCenter({ latitude: cluster.latitude, longitude: cluster.longitude });
    changeZoom(1);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      pan(-PAN_STEP_PX, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      pan(PAN_STEP_PX, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      pan(0, -PAN_STEP_PX);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      pan(0, PAN_STEP_PX);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom(-1);
    }
  };

  return (
    <section
      className="adp-view adp-map"
      aria-label={t("views.map")}
      aria-busy={geoLoading}
      data-map-online={online ? "true" : "false"}
      data-map-zoom={zoom}
    >
      <header className="adp-view-header">
        <h2 className="adp-view-title">{t("views.map")}</h2>
        <label className="adp-map-consent">
          <input
            type="checkbox"
            checked={online}
            disabled={consentBusy}
            data-map-consent="online"
            onChange={(event) => void toggleConsent(event.currentTarget.checked)}
          />
          <span>{t("map.online")}</span>
        </label>
        <Button
          variant="subtle"
          aria-label={t("map.zoomOut")}
          disabled={zoom <= 0}
          onClick={() => changeZoom(-1)}
        >
          −
        </Button>
        <Button
          variant="subtle"
          aria-label={t("map.zoomIn")}
          disabled={zoom >= 19}
          onClick={() => changeZoom(1)}
        >
          +
        </Button>
        <Button
          variant="subtle"
          disabled={cacheBusy}
          data-map-action="clear-cache"
          onClick={() => void clearCache()}
        >
          {t("map.clearCache")}
        </Button>
        <Button variant="subtle" disabled={geoLoading} onClick={() => setRevision((value) => value + 1)}>
          {t("commands.refresh")}
        </Button>
        <HelpButton onOpenHelp={onOpenHelp} />
      </header>
      <p className="adp-map-warning" role="note">
        <span>{t("map.warning")}</span> <span>{t("map.availability")}</span>
      </p>
      {geoError ? (
        <p className="adp-view-error" role="alert">
          {errorText(t, geoError, "map")}
        </p>
      ) : null}
      {tileError ? (
        <p className="adp-view-error" role="alert">
          {tileErrorText(t, tileError)}
        </p>
      ) : null}
      {geoLoading ? (
        <p className="adp-view-loading">{t("search.loading")}</p>
      ) : null}
      <div className="adp-map-body">
        <div
          ref={canvasRef}
          className="adp-map-canvas"
          role="region"
          tabIndex={0}
          aria-label={t("views.map")}
          data-map-center={`${center.latitude.toFixed(4)},${center.longitude.toFixed(4)}`}
          onKeyDown={onKeyDown}
        >
          {[...tiles.entries()].map(([key, loaded]) => {
            const tile = parseTileKey(key);
            if (!tile) return null;
            const position = tileScreenPosition(tile, center, viewport);
            return (
              <img
                key={key}
                className="adp-map-tile"
                src={mapTileUrl(loaded.lease.token)}
                alt=""
                draggable={false}
                width={256}
                height={256}
                style={{ left: `${position.x}px`, top: `${position.y}px` }}
              />
            );
          })}
          {clusters.map((cluster) => (
            <button
              key={cluster.id}
              type="button"
              className="adp-map-cluster"
              data-map-cluster={cluster.count}
              style={{ left: `${cluster.x}px`, top: `${cluster.y}px` }}
              aria-label={`${t("views.map")} ${cluster.count}`}
              onClick={() => zoomToCluster(cluster)}
            >
              {cluster.count}
            </button>
          ))}
          <a
            className="adp-map-attribution"
            href={OSM_COPYRIGHT_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t("map.attribution")}
          </a>
        </div>
        <ul className="adp-map-photo-list" aria-label={t("views.map")}>
          {points.map((point) => (
            <li key={pointId(point)} className="adp-map-photo">
              <button
                type="button"
                className="adp-map-photo-open"
                onClick={() => onOpenFile(point.path)}
              >
                <span className="adp-map-photo-name">{displayName(point.path)}</span>
                {point.date_unix ? (
                  <time dateTime={new Date(point.date_unix * 1000).toISOString()}>
                    {dateFormatter.format(new Date(point.date_unix * 1000))}
                  </time>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {skipped > 0 ? <p className="adp-view-note">{t("map.skipped", { count: skipped })}</p> : null}
      {!geoLoading && !geoError && points.length === 0 ? (
        <p className="adp-view-empty">{t("map.noPhotos")}</p>
      ) : null}
      {!complete && cursor ? (
        <div className="adp-view-more">
          <Button variant="subtle" disabled={geoLoading} onClick={() => void loadMore()}>
            {t("search.loadMore")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
