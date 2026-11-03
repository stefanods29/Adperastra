import { ArrowUp, Repeat2, FileQuestion, RotateCw, ShieldAlert, X } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import Slider from "../components/Slider";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import { handlers } from "../handlers";
import type { FileTabStatus, FindRequest, SaveHandle, ExportHandle } from "../handlers/types";
import type { ArchiveExtractRequest } from "../services/archive";
import { errorCode, errorText } from "../services/errors";
import { displayPath, openItem, parentPathOf, pathSegments } from "../services/explorer";
import { fileDetect, fileGrant, fileRevoke, fileUnblock, fileUrl, type FileTypeInfo } from "../services/files";
import { isTauriRuntime } from "../services/settings";
import type { TabState } from "../services/tabs";

export interface FileTabViewProps {
  onConvert?: (request: Omit<import("../convert/types").ConversionOpenRequest, "nonce">) => void;
  tab: TabState;
  active: boolean;
  /** Show the file in the Explorer tab (folder opened, file selected). */
  onShowInFolder: (path: string) => void;
  /** Open a folder in the Explorer tab (breadcrumb segments). */
  onOpenFolder: (folder: string) => void;
  onClose: () => void;
  onViewState: (state: unknown) => void;
  onOpenHelp: (slug: string) => void;
  /** Settings > Opening files > Protected view (Step 04c). */
  protectedViewEnabled: boolean;
  /** The tab has unsaved changes (Step 06a). */
  isDirty?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  registerSave?: (handle: SaveHandle | null) => void;
  /** The file was saved under a new name (Step 06a). */
  onPathChange?: (path: string) => void;
  /** Asked before a reload throws unsaved changes away (Step 06a). */
  onConfirmDiscard?: () => Promise<boolean>;
  /** Open another file in a new tab; the archive tab opens a file that lives
   * inside it this way (Step 06d). Rejects with a `files.*` code. */
  onOpenFile?: (path: string) => Promise<void>;
  /** Extract through the Explorer's jobs panel (Step 06d). */
  onExtractArchive?: (request: ArchiveExtractRequest) => void;
  /** Open this file in the text viewer (Step 06f). */
  onOpenAsText?: () => void;
  /** OCR language preference from settings (Step 07e). */
  ocrLanguage?: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; info: FileTypeInfo; token: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** One file tab (Step 04a): navigation row, the handler's view, and the
 * file tab's own status bar. Gets a file token when it mounts and gives it
 * back when it unmounts (plan/pitfalls.md P-28). */
export default function FileTabView({
  tab,
  active,
  onShowInFolder,
  onOpenFolder,
  onClose,
  onViewState,
  onOpenHelp,
  protectedViewEnabled,
  isDirty = false,
  onDirtyChange,
  registerSave,
  onPathChange,
  onConfirmDiscard,
  onOpenFile,
  onExtractArchive,
  onConvert,
  onOpenAsText,
  ocrLanguage,
}: FileTabViewProps) {
  const { t } = useTranslation();
  const exportHandle = useRef<ExportHandle | null>(null);
  const registerExport = useCallback((handle: ExportHandle | null) => { exportHandle.current = handle; }, []);
  const path = tab.path ?? "";
  const handler = tab.handler ? handlers.get(tab.handler) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<FileTabStatus>({ items: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [find, setFind] = useState<FindRequest>({ text: "", request: 0, backwards: false });
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState("");
  const [options, setOptions] = useState({ caseSensitive: false, wholeWord: false });
  const [replaceRequest, setReplaceRequest] = useState<{ request: number; all: boolean } | null>(null);
  const replaceCount = useRef(0);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const replaceRef = useRef<HTMLDivElement | null>(null);
  const [unblocked, setUnblocked] = useState(false);
  const [askUnblock, setAskUnblock] = useState(false);
  const [unblockError, setUnblockError] = useState<string | null>(null);
  const canFind = handler?.supportsFind === true;
  const supportsReplace = handler?.supportsReplace === true;
  const findAgain = useCallback((backwards: boolean) => {
    setFind((current) => ({ ...current, request: current.request + 1, backwards }));
  }, []);
  const askReplace = useCallback((all: boolean) => {
    replaceCount.current += 1;
    setReplaceRequest({ request: replaceCount.current, all });
  }, []);

  // F5 reloads (asking first when there are unsaved changes); Ctrl+F focuses
  // the search box; F3 / Shift+F3 find the next / previous match.
  const reload = useCallback(async () => {
    if (isDirty && onConfirmDiscard) {
      const proceed = await onConfirmDiscard();
      if (!proceed) return;
    }
    setReloadKey((value) => value + 1);
  }, [isDirty, onConfirmDiscard]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void reload();
        return;
      }
      if (!canFind) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        const input = searchRef.current?.querySelector("input");
        input?.focus();
        input?.select();
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "h" || event.key === "H")) {
        if (!supportsReplace) return;
        event.preventDefault();
        setReplaceOpen(true);
      } else if (event.key === "F3") {
        event.preventDefault();
        findAgain(event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, canFind, findAgain, supportsReplace, reload]);

  // The replace row's text box takes the focus when it opens (Ctrl+H).
  useEffect(() => {
    if (!replaceOpen) return;
    replaceRef.current?.querySelector("input")?.focus();
  }, [replaceOpen]);

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

  // Protected view (Step 04c): a file from the internet shows a yellow bar;
  // Unblock removes the mark after the user confirms.
  const protectedView = phase.kind === "ready" && phase.info.from_internet && protectedViewEnabled && !unblocked;
  const unblock = useCallback(() => {
    void fileUnblock(path)
      .then(() => {
        setUnblocked(true);
        setAskUnblock(false);
        setUnblockError(null);
      })
      .catch((error: unknown) => setUnblockError(errorText(t, error, "files")));
  }, [path, t]);

  const folder = parentPathOf(path);
  const segments = pathSegments(path).map((segment, index, all) => ({
    id: index === all.length - 1 ? "" : segment.path,
    label: segment.label,
  }));
  // The search box, its options, and a replace request when one was asked.
  const viewFind: FindRequest = {
    ...find,
    options,
    replace: replaceRequest
      ? { text: replaceText, request: replaceRequest.request, all: replaceRequest.all }
      : undefined,
  };
  return (
    <div className="adp-filetab" hidden={!active}>
      <div className="adp-filetab-nav">
        <IconButton icon={ArrowUp} labelKey="fileTab.showInFolder" shortcut="Alt+Up" onClick={() => onShowInFolder(path)} />
        <IconButton icon={RotateCw} labelKey="fileTab.reload" shortcut="F5" onClick={() => void reload()} />
        {handler?.id === "image" && phase.kind === "ready" && onConvert ? (
          <IconButton icon={Repeat2} labelKey="commands.convertTo" onClick={() => {
            const handle = exportHandle.current;
            if (!handle) {
              if (!isDirty) onConvert({ inputs: [{ kind: "file", path }], release: async () => undefined });
              return;
            }
            void handle.capture().then((snapshot) => onConvert({
              inputs: [{ kind: "snapshot", snapshot_id: snapshot.snapshot_id, document_id: snapshot.document_id, revision: snapshot.revision }],
              release: async () => { await handle.dispose?.(snapshot.snapshot_id); },
            })).catch((error: unknown) => setPhase({ kind: "error", message: errorText(t, error, "snapshot") }));
          }} />
        ) : null}
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
      {replaceOpen && supportsReplace ? (
        <div
          ref={replaceRef}
          className="adp-filetab-replace"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setReplaceOpen(false);
              searchRef.current?.querySelector("input")?.focus();
              return;
            }
            if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            askReplace(event.ctrlKey && event.altKey);
          }}
        >
          <TextInput
            value={replaceText}
            onChange={setReplaceText}
            placeholder={t("editor.replaceWith")}
            ariaLabel={t("editor.replaceWith")}
          />
          <Switch
            checked={options.caseSensitive}
            onChange={(caseSensitive) => setOptions((current) => ({ ...current, caseSensitive }))}
            label={t("editor.matchCase")}
          />
          <Switch
            checked={options.wholeWord}
            onChange={(wholeWord) => setOptions((current) => ({ ...current, wholeWord }))}
            label={t("editor.wholeWord")}
          />
          <Button disabled={find.text === ""} onClick={() => askReplace(false)}>
            {t("editor.replace")}
          </Button>
          <Button disabled={find.text === ""} onClick={() => askReplace(true)}>
            {t("editor.replaceAll")}
          </Button>
          <IconButton icon={X} labelKey="editor.closeReplace" onClick={() => setReplaceOpen(false)} />
        </div>
      ) : null}
      {protectedView ? (
        <div className="adp-protected-bar" role="status">
          <ShieldAlert size={16} aria-hidden="true" className="adp-protected-icon" />
          <span className="adp-protected-text">{t("protected.message")}</span>
          <Button onClick={() => setAskUnblock(true)}>{t("protected.unblock")}</Button>
          <HelpButton onOpenHelp={() => onOpenHelp("protected-view")} />
        </div>
      ) : null}
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
              find={viewFind}
              protectedView={protectedView}
              onDirtyChange={onDirtyChange}
              registerExport={registerExport}
              registerSave={registerSave}
              onPathChange={onPathChange}
              onOpenFile={onOpenFile}
              onExtractArchive={onExtractArchive}
              onOpenAsText={onOpenAsText}
              ocrLanguage={ocrLanguage}
            />
          </Suspense>
        ) : null}
      </div>
      {askUnblock ? (
        <Dialog title={t("protected.unblockTitle")} onClose={() => setAskUnblock(false)}>
          <p className="adp-dialog-text">{t("protected.unblockBody", { name: tab.title ?? "" })}</p>
          {unblockError ? (
            <p className="adp-dialog-text adp-protected-error" role="alert">
              {unblockError}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={unblock}>
              {t("protected.unblock")}
            </Button>
            <Button onClick={() => setAskUnblock(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
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
