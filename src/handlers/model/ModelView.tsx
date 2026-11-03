import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mesh, Raycaster, Vector2, Vector3 } from "three";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { errorText } from "../../services/errors";
import { fileUrl } from "../../services/files";
import type { JobHandle } from "../../services/jobs";
import {
  closeSpecialView,
  modelScene,
  openSpecialView,
  readModelViewState,
  type ModelViewState,
  type SafeSceneData,
  type SceneInfo,
  type SceneUnit,
  type SpecialSession,
} from "../../services/specialViews";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { createModelCommands, type ModelCommandContext } from "./modelCommands";
import {
  boundsCenter,
  defaultView,
  distanceParts,
  fitDistance,
  orbitPosition,
  validateView,
  type Bounds,
  type Vec3,
} from "./modelCamera";
import {
  buildModel,
  createRenderer,
  RenderLoop,
  setWireframe,
  updateCamera,
  type BuiltModel,
  type RendererBundle,
} from "./modelRenderer";
import { decodeSafeScene } from "./safeScene";

const RIBBON: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "camera",
          labelKey: "ribbon.zoom",
          controls: [
            { type: "button", command: "model.fit", keyTip: "F" },
            { type: "toggle", command: "model.wireframe", keyTip: "W" },
            { type: "toggle", command: "model.measure", keyTip: "M" },
          ],
        },
      ],
    },
  ],
};

const UNIT_KEYS: Record<SceneUnit, string> = {
  none: "model.unitNone",
  mm: "model.unitMm",
  cm: "model.unitCm",
  m: "model.unitM",
};

/** Bounded interactive model view (Step 07g D4). */
export default function ModelView({ info, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [infoScene, setInfoScene] = useState<SceneInfo | null>(null);
  const [scene, setScene] = useState<SafeSceneData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "online">(() => (info.online_only ? "online" : "loading"));
  const [slow, setSlow] = useState(false);
  const [view, setView] = useState<ModelViewState | null>(() => readModelViewState(savedState));
  const [measure, setMeasure] = useState<{ points: Vec3[]; distance: number | null }>({ points: [], distance: null });
  const [measuring, setMeasuring] = useState(false);
  const job = useRef<JobHandle<SpecialSession> | null>(null);
  const sessionRef = useRef<SpecialSession | null>(null);
  const bundleRef = useRef<RendererBundle | null>(null);
  const builtRef = useRef<BuiltModel | null>(null);
  const loopRef = useRef<RenderLoop | null>(null);
  const viewRef = useRef<ModelViewState | null>(null);
  const applyingRef = useRef(false);

  const applyView = useCallback(
    (next: ModelViewState) => {
      viewRef.current = next;
      setView(next);
      onStateChange(next);
      const bundle = bundleRef.current;
      if (bundle) {
        applyingRef.current = true;
        updateCamera(bundle, orbitPosition(next), next.target);
        applyingRef.current = false;
        loopRef.current?.request();
      }
    },
    [onStateChange],
  );

  useEffect(() => {
    let cancelled = false;
    setPhase(info.online_only ? "online" : "loading");
    if (info.online_only) return;
    void (async () => {
      try {
        const handle = await openSpecialView(info.path, "model");
        job.current = handle;
        const opened = await handle.completion;
        sessionRef.current = opened;
        const found = await modelScene(opened.session_id);
        const response = await fetch(fileUrl(found.geometry.token, found.geometry.name), { cache: "no-store" });
        if (!response.ok) throw new Error("special_view.unavailable");
        const bytes = await response.arrayBuffer();
        const decoded = decodeSafeScene(bytes, 2_000_000, 4_000_000);
        if (cancelled) return;
        sessionRef.current = opened;
        setInfoScene(found);
        setScene(decoded);
        const initial = readModelViewState(savedState) ?? defaultView(found.bounds, found.unit, 1);
        viewRef.current = initial;
        setView(initial);
        setPhase("ready");
      } catch {
        const opened = sessionRef.current;
        sessionRef.current = null;
        if (opened) void closeSpecialView(opened.session_id).catch(() => undefined);
        if (!cancelled) setPhase("error");
      } finally {
        job.current = null;
      }
    })();
    return () => {
      cancelled = true;
      void job.current?.cancel();
      job.current = null;
      const opened = sessionRef.current;
      sessionRef.current = null;
      if (opened) void closeSpecialView(opened.session_id).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.path, info.online_only]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Renderer and model resources live exactly as long as this tab view.
  useEffect(() => {
    if (!scene || !infoScene) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const bundle = createRenderer(canvas);
    bundleRef.current = bundle;
    const textureUrls = infoScene.textures.map((texture) => fileUrl(texture.token, texture.name));
    const built = buildModel(scene, textureUrls);
    builtRef.current = built;
    bundle.scene.add(built.root);
    const loop = new RenderLoop(() => bundle.renderer.render(bundle.scene, bundle.camera));
    loopRef.current = loop;
    const resize = () => {
      bundle.resize(stage.clientWidth, stage.clientHeight);
      loop.request();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    const onControls = () => {
      if (applyingRef.current) return;
      const previous = viewRef.current;
      if (!previous) return;
      const offset = bundle.camera.position.clone().sub(bundle.controls.target);
      const distance = Math.max(1e-6, offset.length());
      const next: ModelViewState = {
        ...previous,
        yaw: Math.atan2(offset.x, offset.z),
        pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / distance))),
        distance,
        target: [bundle.controls.target.x, bundle.controls.target.y, bundle.controls.target.z],
      };
      viewRef.current = next;
      setView(next);
      onStateChange(next);
      loop.request();
    };
    bundle.controls.addEventListener("change", onControls);
    const current = viewRef.current ?? defaultView(infoScene.bounds, infoScene.unit, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    applyView(current);
    loop.request();
    return () => {
      bundle.controls.removeEventListener("change", onControls);
      observer.disconnect();
      loop.dispose();
      loopRef.current = null;
      built.dispose();
      builtRef.current = null;
      bundle.dispose();
      bundleRef.current = null;
    };
  }, [applyView, infoScene, onStateChange, scene]);

  useEffect(() => {
    loopRef.current?.setActive(active);
  }, [active]);

  const bounds = infoScene?.bounds ?? [0, 0, 0, 0, 0, 0] as Bounds;
  const current = view ?? defaultView(bounds, "none", 1);

  const fit = useCallback(() => {
    if (!infoScene) return;
    const aspect = canvasRef.current ? canvasRef.current.clientWidth / Math.max(1, canvasRef.current.clientHeight) : 1;
    applyView({ ...current, distance: fitDistance(infoScene.bounds, 45, aspect), target: boundsCenter(infoScene.bounds) });
  }, [applyView, current, infoScene]);

  const toggleWireframe = useCallback(() => {
    const next = { ...current, wireframe: !current.wireframe };
    if (builtRef.current) setWireframe(builtRef.current, next.wireframe);
    applyView(next);
    loopRef.current?.request();
  }, [applyView, current]);

  const toggleMeasure = useCallback(() => {
    setMeasuring((value) => !value);
    setMeasure({ points: [], distance: null });
  }, []);

  const commands = useMemo(() => createModelCommands({ fit, toggleWireframe, toggleMeasure }), [fit, toggleWireframe, toggleMeasure]);
  const context: ModelCommandContext = { hasModel: scene !== null, wireframe: current.wireframe, measuring };
  useCommandShortcuts(commands, context, active);

  useEffect(() => {
    const items: string[] = [];
    if (measure.distance !== null) {
      const parts = distanceParts(measure.distance, current.unit);
      items.push(t("model.distance", { value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(parts.value) }));
    }
    if (infoScene?.partial) items.push(t("model.partial"));
    onStatus({ items });
  }, [current.unit, i18n.language, infoScene?.partial, measure.distance, onStatus, t]);

  const onCanvasKey = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!scene) return;
    const step = 0.12;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      applyView({ ...current, yaw: current.yaw + (event.key === "ArrowLeft" ? step : -step) });
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      applyView({ ...current, pitch: current.pitch + (event.key === "ArrowUp" ? step : -step) });
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      applyView({ ...current, distance: Math.min(1e9, Math.max(1e-6, current.distance * (event.key === "-" ? 1.15 : 0.87))) });
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fit();
    }
  };

  const onPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!measuring || !bundleRef.current || !builtRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, bundleRef.current.camera);
    const hit = raycaster.intersectObject(builtRef.current.root, true)[0];
    if (!hit) return;
    // Measure between model vertices, not an arbitrary surface point.
    let point = hit.point;
    if (hit.face && hit.object instanceof Mesh) {
      const attribute = hit.object.geometry.getAttribute("position");
      const candidates = [hit.face.a, hit.face.b, hit.face.c].map((index) => {
        const vertex = new Vector3().fromBufferAttribute(attribute, index).applyMatrix4(hit.object.matrixWorld);
        return { vertex, distance: vertex.distanceToSquared(hit.point) };
      });
      candidates.sort((a, b) => a.distance - b.distance);
      point = candidates[0].vertex;
    }
    const next = [...measure.points, [point.x, point.y, point.z] as Vec3].slice(-2);
    setMeasure({ points: next, distance: next.length === 2 ? Math.hypot(next[0][0] - next[1][0], next[0][1] - next[1][1], next[0][2] - next[1][2]) : null });
  };

  const ribbon = <Ribbon def={RIBBON} ctx={context} commands={commands as Command<ModelCommandContext>[]} accent="image" active={active} />;

  return (
    <ViewerFrame ribbon={ribbon}>
      <div className="adp-model-view">
        <div ref={stageRef} className="adp-model-stage">
          {phase === "online" ? (
            <div className="adp-viewer-message" role="status">
              <p>{t("preview.onlineOnly")}</p>
              <Button variant="primary" onClick={onOpenInWindowsApp}>{t("common.open")}</Button>
            </div>
          ) : null}
          {phase === "error" ? (
            <div className="adp-viewer-message" role="alert">
              <p>{errorText(t, new Error("special_view.corrupt"), "special_view")}</p>
              <Button variant="primary" onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
            </div>
          ) : null}
          {phase === "loading" ? (
            <div className="adp-model-loading" role="status" aria-label={t("components.loading")}>
              <div className="adp-skeleton-tile adp-model-skeleton" />
              {slow ? <p>{t("preview.loading")}</p> : null}
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            className="adp-model-canvas"
            tabIndex={0}
            aria-label={info.name}
            hidden={phase !== "ready"}
            onKeyDown={onCanvasKey}
            onPointerDown={onPointer}
          />
        </div>
        <aside className="adp-model-properties" aria-label={t("model.units")}>
          <label className="adp-model-unit">
            <span>{t("model.units")}</span>
            <select
              className="adp-input"
              value={current.unit}
              onChange={(event) => applyView({ ...current, unit: event.currentTarget.value as SceneUnit })}
            >
              {(["none", "mm", "cm", "m"] as SceneUnit[]).map((unit) => (
                <option key={unit} value={unit}>{t(UNIT_KEYS[unit])}</option>
              ))}
            </select>
          </label>
          <dl className="adp-model-facts">
            <div><dt>{t("model.orbit")}</dt><dd>{new Intl.NumberFormat(i18n.language, { style: "unit", unit: "degree", maximumFractionDigits: 0 }).format((current.yaw * 180) / Math.PI)}</dd></div>
            <div><dt>{t("model.fit")}</dt><dd>{new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(current.distance)}</dd></div>
          </dl>
          {measure.distance !== null ? (
            <p className="adp-model-distance">{t("model.distance", { value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(measure.distance) })}</p>
          ) : null}
          {infoScene?.partial ? <p className="adp-model-partial">{t("model.partial")}</p> : null}
        </aside>
      </div>
    </ViewerFrame>
  );
}
