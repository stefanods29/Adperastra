import { Cloud, FileQuestion } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { previewTargetFor, previewViewProps, PreviewGrantStore, type PreviewGrant } from "../preview/previewHandler";
import type { FileTabStatus, FindRequest } from "../handlers/types";
import type { FileTypeInfo } from "../services/files";
import { previewDetect } from "../services/previewAccess";
import { isTauriRuntime } from "../services/settings";
import { fileTile } from "../views/explorer/fileTile";
import Button from "./Button";
import HelpButton from "./HelpButton";
import Skeleton from "./Skeleton";
import SearchBox from "./SearchBox";
import PreviewErrorBoundary from "./PreviewErrorBoundary";
export const PREVIEW_SLOW_MS = 1000;
export interface PreviewSurfaceProps {
  info: FileTypeInfo; active: boolean; onOpen: () => Promise<void>;
  onStatus?: (status: FileTabStatus) => void; onOpenHelp?: (slug: string) => void;
  /** Listing/watch generation, including same-size subsecond edits. */
  sourceRevision?: unknown;
  find?: FindRequest;
  /** Automatic pane work obeys the shared background policy. */
  background?: boolean;
}
export function PreviewFallback({ name, cloud = false, onOpen, onOpenHelp }: { name: string; cloud?: boolean; onOpen: () => Promise<void>; onOpenHelp?: (slug: string) => void }) {
  const { t } = useTranslation();
  const tile = fileTile(name, "file");
  const Icon = cloud ? Cloud : tile.icon ?? FileQuestion;
  return <div className="adp-preview-fallback" role="status">
    <span className={`adp-file-tile adp-file-tile--${tile.tone} adp-preview-tile`} aria-hidden="true"><Icon size={48} /></span>
    <p>{t(cloud ? "preview.onlineOnly" : "preview.unavailable")}</p>
    <div className="adp-preview-fallback-actions">
      <Button variant="primary" onClick={() => void onOpen()}>{t("preview.open")}</Button>
      {onOpenHelp ? <HelpButton onOpenHelp={() => onOpenHelp("quick-preview")} /> : null}
    </div>
  </div>;
}
export default function PreviewSurface({ info, active, onOpen, onStatus, onOpenHelp, sourceRevision, find: externalFind, background = false }: PreviewSurfaceProps) {
  const { t } = useTranslation();
  const store = useRef<PreviewGrantStore | null>(null);
  if (!store.current) store.current = new PreviewGrantStore();
  const [grant, setGrant] = useState<PreviewGrant | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [find, setFind] = useState<FindRequest>({ text: "", request: 0, backwards: false });
  const searchRef = useRef<HTMLDivElement>(null);
  const initialTarget = previewTargetFor(info);
  const key = JSON.stringify([info.path, info.name, info.ext, info.mime, info.size, info.modified_unix, info.online_only, info.from_internet, info.read_only]);
  const liveInfo = useRef(info); liveInfo.current = info;
  useEffect(() => {
    let alive = true;
    const current = store.current!;
    setGrant(null); setFailed(false); setSlow(false); setFind({ text: "", request: 0, backwards: false });
    if (!active || initialTarget.kind !== "preview" || !isTauriRuntime()) {
      current.release();
      if (active && initialTarget.kind === "preview" && !isTauriRuntime()) setFailed(true);
      return () => { alive = false; current.release(); };
    }
    const timer = window.setTimeout(() => { if (alive) setSlow(true); }, PREVIEW_SLOW_MS);
    void current.acquire(liveInfo.current, background).then(next => {
      if (alive && next) setGrant(next);
    }).catch(() => { if (alive) setFailed(true); }).finally(() => window.clearTimeout(timer));
    return () => { alive = false; window.clearTimeout(timer); current.release(); };
  }, [key, initialTarget.kind, active, sourceRevision, background]);
  const currentInfo = grant?.info ?? info;
  const target = previewTargetFor(currentInfo);
  const fallback = <PreviewFallback name={info.name} cloud={target.kind === "cloud"} onOpen={onOpen} onOpenHelp={onOpenHelp} />;
  if (target.kind !== "preview" || failed) return fallback;
  if (!active) return null;
  if (!grant) return <div className="adp-preview-loading" role="status" aria-label={t("preview.loading")}><Skeleton variant="rows" count={4} />{slow ? <p>{t("preview.loading")}</p> : null}</div>;
  const View = target.handler.view;
  const next = (backwards: boolean) => setFind(value => ({ ...value, request: value.request + 1, backwards }));
  return <div className="adp-preview-surface" data-handler={target.handler.id} onKeyDown={event => {
    if (event.defaultPrevented || !target.handler.supportsFind) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); searchRef.current?.querySelector("input")?.focus(); }
    else if (event.key === "F3") { event.preventDefault(); next(event.shiftKey); }
  }}>
    {target.handler.supportsFind && !externalFind ? <div className="adp-preview-find" ref={searchRef} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); next(event.shiftKey); } }}>
      <SearchBox value={find.text} placeholder={t("fileTab.searchIn", { name: info.name })} onChange={text => setFind(value => ({ ...value, text, request: value.request + 1 }))} />
    </div> : null}
    <PreviewErrorBoundary key={grant.token} onError={() => { store.current?.release(); setGrant(null); setFailed(true); }}>
      <Suspense fallback={<div className="adp-preview-loading" role="status" aria-label={t("preview.loading")}><Skeleton variant="rows" count={4} /></div>}>
        <View key={grant.token} {...previewViewProps(currentInfo, grant.url, active, { onOpen, onStatus, onOpenHelp }, externalFind ?? find)} />
      </Suspense>
    </PreviewErrorBoundary>
  </div>;
}
export function usePreviewInfo(path: string | null, onlineOnly: boolean, sourceRevision?: unknown, active = true): FileTypeInfo | null {
  const [info, setInfo] = useState<FileTypeInfo | null>(null);
  useEffect(() => {
    let alive = true; setInfo(null);
    if (path === null || onlineOnly || !active || !isTauriRuntime()) return;
    const timer = window.setTimeout(() => { void previewDetect(path, true).then(next => { if (alive) setInfo(next); }).catch(() => undefined); }, 150);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [path, onlineOnly, sourceRevision, active]);
  return info;
}
