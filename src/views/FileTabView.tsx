import { ArrowUp, FileQuestion, RotateCw } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import Slider from "../components/Slider";
import { handlers } from "../handlers";
import type { FileTabStatus, FindRequest } from "../handlers/types";
import { errorCode, errorText } from "../services/errors";
import { displayPath, openItem, parentPathOf, pathSegments } from "../services/explorer";
import { fileDetect, fileGrant, fileRevoke, fileUrl, type FileTypeInfo } from "../services/files";
import { isTauriRuntime } from "../services/settings";
import type { TabState } from "../services/tabs";

export interface FileTabViewProps {
  tab: TabState;
  active: boolean;
  /** Show the file in the Explorer tab (folder opened, file selected). */
  onShowInFolder: (path: string) => void;
  /** Open a folder in the Explorer tab (breadcrumb segments). */
  onOpenFolder: (folder: string) => void;
  onClose: () => void;
  onViewState: (state: unknown) => void;
  onOpenHelp: (slug: string) => void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; info: FileTypeInfo; token: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** One file tab (Step 04a): navigation row, the handler's view, and the
 * file tab's own status bar. Gets a file token when it mounts and gives it
 * back when it unmounts (plan/pitfalls.md P-28). */
export default function FileTabView({ tab, active, onShowInFolder, onOpenFolder, onClose, onViewState, onOpenHelp }: FileTabViewProps) {
  const { t } = useTranslation();
  const path = tab.path ?? "";
  const handler = tab.handler ? handlers.get(tab.handler) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<FileTabStatus>({ items: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [find, setFind] = useState<FindRequest>({ text: "", request: 0, backwards: false });
  const searchRef = useRef<HTMLDivElement | null>(null);
  const canFind = handler?.supportsFind === true;
  const findAgain = useCallback((backwards: boolean) => {
    setFind((current) => ({ ...current, request: current.request + 1, backwards }));
  }, []);

  // Ctrl+F focuses the search box; F3 / Shift+F3 find the next / previous match.
  useEffect(() => {
    if (!active || !canFind) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        const input = searchRef.current?.querySelector("input");
        input?.focus();
        input?.select();
      } else if (event.key === "F3") {
        event.preventDefault();
        findAgain(event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, canFind, findAgain]);

  useEffect(() => {
    if (!isTauriRuntime() || !path) return;
    let cancelled = false;
    let token: string | null = null;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const info = await fileDetect(path);
        const granted = await fileGrant(path);
        if (cancelled) {
          void fileRevoke(granted).catch(() => undefined);
          return;
        }
        token = granted;
        setPhase({ kind: "ready", info, token: granted });
      } catch (error) {
        if (cancelled) return;
        if (errorCode(error) === "files.not_found") setPhase({ kind: "missing" });
        else setPhase({ kind: "error", message: errorText(t, error, "files") });
      }
    })();
    return () => {
      cancelled = true;
      if (token) void fileRevoke(token).catch(() => undefined);
    };
  }, [path, reloadKey, t]);

  const openInWindowsApp = useCallback(() => {
    if (isTauriRuntime()) void openItem(path).catch(() => undefined);
  }, [path]);

  const folder = parentPathOf(path);
  const segments = pathSegments(path).map((segment, index, all) => ({
    id: index === all.length - 1 ? "" : segment.path,
    label: segment.label,
  }));
  return (
    <div className="adp-filetab" hidden={!active}>
      <div className="adp-filetab-nav">
        <IconButton icon={ArrowUp} labelKey="fileTab.showInFolder" shortcut="Alt+Up" onClick={() => onShowInFolder(path)} />
        <IconButton icon={RotateCw} labelKey="fileTab.reload" shortcut="F5" onClick={() => setReloadKey((value) => value + 1)} />
        <div className="adp-filetab-address">
          <Breadcrumb segments={segments} onNavigate={(id) => (id ? onOpenFolder(id) : undefined)} />
        </div>
        {canFind ? (
          <div
            ref={searchRef}
            className="adp-filetab-search"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findAgain(event.shiftKey);
              } else if (event.key === "Escape") {
                setFind((current) => ({ ...current, text: "" }));
              }
            }}
          >
            <SearchBox
              value={find.text}
              onChange={(text) => setFind((current) => ({ ...current, text }))}
              placeholder={t("fileTab.searchIn", { name: tab.title ?? "" })}
            />
          </div>
        ) : null}
        <HelpButton onOpenHelp={() => onOpenHelp(handler?.helpSlug ?? "opening-files")} />
      </div>
      <div className="adp-filetab-body">
        {phase.kind === "loading" ? <Skeleton variant="tiles" count={1} /> : null}
        {phase.kind === "missing" ? (
          <div className="adp-viewer-message" role="alert">
            <FileQuestion size={32} aria-hidden="true" />
            <p>{t("fileTab.notFoundTitle")}</p>
            {folder ? <p className="adp-viewer-detail">{t("fileTab.notFoundBody", { folder: displayPath(folder) })}</p> : null}
            <div className="adp-dialog-actions">
              {folder ? <Button onClick={() => onOpenFolder(folder)}>{t("fileTab.openFolder")}</Button> : null}
              <Button onClick={onClose}>{t("tabs.close")}</Button>
            </div>
          </div>
        ) : null}
        {phase.kind === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{phase.message}</p>
            <Button variant="primary" onClick={openInWindowsApp}>
              {t("fileTab.openInWindowsApp")}
            </Button>
          </div>
        ) : null}
        {phase.kind === "ready" && handler ? (
          <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
            <handler.view
              key={phase.token}
              info={phase.info}
              url={fileUrl(phase.token, phase.info.name)}
              active={active}
              savedState={tab.view ?? null}
              onStateChange={onViewState}
              onStatus={setStatus}
              onOpenInWindowsApp={openInWindowsApp}
              find={find}
            />
          </Suspense>
        ) : null}
      </div>
      <footer className="adp-statusbar adp-filetab-status">
        {status.items.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {status.zoom ? (
          <span className="adp-filetab-zoom">
            <Button variant="subtle" onClick={status.zoom.fit}>
              {t("viewer.fit")}
            </Button>
            <Slider
              value={status.zoom.percent}
              min={status.zoom.min}
              max={status.zoom.max}
              label={t("viewer.zoom")}
              onChange={status.zoom.set}
            />
          </span>
        ) : null}
      </footer>
    </div>
  );
}
