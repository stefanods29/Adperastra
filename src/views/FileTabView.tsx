import { ArrowUp, Repeat2, FileQuestion, RotateCw, ShieldAlert, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
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
import TabErrorBoundary from "../components/TabErrorBoundary";
import TextInput from "../components/TextInput";
import { handlers } from "../handlers";
import { documentControllerFactory } from "../documents/controller";
import { prepareDocumentClose } from "../documents/closePolicies";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import type { DocumentHandle, DocumentRef } from "../documents/types";
import { useRecoveryCapture } from "../documents/useRecoveryCapture";
import LockedFolderView from "../locked/LockedFolderView";
import { virtualPresenterFor } from "../locked/VirtualTextView";
import { isSerializableViewState } from "../services/viewState";
import type { FileTabStatus, FindRequest, SaveHandle, ExportHandle } from "../handlers/types";
import StatusFieldHost from "../shell/StatusFieldHost";
import { statusFields } from "../shell/registries";
import type { StatusCustomization, StatusKind } from "../shell/types";
import type { ArchiveExtractRequest } from "../services/archive";
import { errorCode, errorText } from "../services/errors";
import { displayPath, openItem, parentPathOf, pathSegments } from "../services/explorer";
import { extensionOf, fileDetect, fileGrant, fileRevoke, fileUnblock, fileUrl, type FileTypeInfo } from "../services/files";
import { lockedEntryInfo, type LockedSession } from "../services/lockedFolders";
import { isTauriRuntime } from "../services/settings";
import type { TabState } from "../services/tabs";

/** The shared restore budget (Step 09i D7): at most two opens run at once
 * across normal and split restore. A viewer only needs the bounded `run`. */
export interface OpenBudget {
  run<T>(work: () => Promise<T>): Promise<T>;
}

const AiActionsLauncher = lazy(() => import("../ai-actions/AiActionsLauncher"));
const ExtractionLauncher = lazy(() => import("../extraction/ExtractionLauncher"));
const ExtractionReviewHost = lazy(() => import("../extraction/ExtractionReviewHost"));

export interface FileTabViewProps {
  onConvert?: (request: Omit<import("../convert/types").ConversionOpenRequest, "nonce">) => void;
  tab: TabState;
  /** True while this leaf owns keyboard commands. */
  active: boolean;
  /** Split leaves pass `visible` for both sides so the inactive side stays
   * painted; a normal mounted tab defaults to painting only while it is the
   * active tab (it stays mounted so its scroll position survives). */
  visible?: boolean;
  /** Stable split-leaf identity for scroll synchronization (Step 09i). */
  syncViewId?: string;
  /** The window's shared two-open budget for restore (Step 09i D7). */
  openBudget?: OpenBudget;
  /** Show the file in the Explorer tab (folder opened, file selected). */
  onShowInFolder: (path: string) => void;
  /** Open a folder in the Explorer tab (breadcrumb segments). */
  onOpenFolder: (folder: string) => void;
  onClose: () => void;
  onViewState: (state: unknown) => void;
  onOpenHelp: (slug: string) => void;
  /** Settings > Opening files > Protected view (Step 04c). */
  protectedViewEnabled: boolean;
  /** Saved status bar customization (Step 10e); absent keeps the legacy bar. */
  statusCustomization?: StatusCustomization;
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
  /** Open this media as a new editable recipe (Step 15). */
  onEditMedia?: (subtitlePath?: string) => void;
  /** OCR language preference from settings (Step 07e). */
  ocrLanguage?: string;
  /** Crash-recovery capture for documents a handler presents through a
   * shared handle (Step 09h). The shell passes Settings > Recovery; the
   * defaults are the schema-25 defaults. */
  recovery?: { enabled: boolean; interval_seconds: number };
  /** The one live unlocked container, if any (Step 09k). */
  lockedSession?: LockedSession | null;
  onLockedSessionChange?: (session: LockedSession) => void;
  /** Virtual folder navigation inside the same locked tab. */
  onLockedNavigate?: (tabId: string, entryId: string) => void;
  /** A supported file entry opens in its own virtual file tab. */
  onOpenLockedEntry?: (
    source: Extract<DocumentRef, { kind: "virtual" }>,
    entryId: string,
  ) => void;
  onLockedExportEntry?: (entryId: string) => void;
  onLockedRecovery?: () => void;
}

/** Schema-25 recovery defaults, used until the shell passes the saved
 * Settings > Recovery values (same values as `defaultSettings().recovery`). */
const DEFAULT_RECOVERY_CAPTURE = { enabled: true, interval_seconds: 10 };

interface DocumentRecoveryCaptureProps {
  document: DocumentHandle;
  options: { enabled: boolean; interval_seconds: number };
  onWarning: (code: string) => void;
}

/** One lease of the canonical capture scheduler for a document-backed view
 * (Step 09h E3). Renders nothing; the registry owns the schedule. */
function DocumentRecoveryCapture({ document, options, onWarning }: DocumentRecoveryCaptureProps) {
  useRecoveryCapture(document, options, onWarning);
  return null;
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
  visible = active,
  syncViewId,
  openBudget,
  onShowInFolder,
  onOpenFolder,
  onClose,
  onViewState,
  onOpenHelp,
  protectedViewEnabled,
  statusCustomization,
  isDirty = false,
  onDirtyChange,
  registerSave,
  onPathChange,
  onConfirmDiscard,
  onOpenFile,
  onExtractArchive,
  onConvert,
  onOpenAsText,
  onEditMedia,
  ocrLanguage,
  recovery,
  lockedSession,
  onLockedSessionChange,
  onLockedNavigate,
  onOpenLockedEntry,
  onLockedExportEntry,
  onLockedRecovery,
}: FileTabViewProps) {
  const { t } = useTranslation();
  const exportHandle = useRef<ExportHandle | null>(null);
  const registerExport = useCallback((handle: ExportHandle | null) => { exportHandle.current = handle; }, []);
  const path = tab.path ?? "";
  const handler = tab.handler ? handlers.get(tab.handler) : undefined;
  const canExtract =
    handler?.id === "pdf" || handler?.id === "image" || handler?.id === "image-project";
  const lockedSource = tab.source?.kind === "virtual" ? tab.source : null;
  // A recipe draft has no disk source and no DocumentRegistry entry: its
  // handle lives only with this tab (Step 15 "Edit media").
  const draftDocument = tab.draft ?? null;
  // `document_id` is runtime-only; the host sets it on a file entry tab.
  const lockedBrowser = lockedSource !== null && tab.document_id !== "locked-virtual-file";
  // A virtual tab re-acquires when the session that serves its container
  // appears, is replaced, or moves to a new revision: the locked provider
  // refuses bytes from any other session (Step 09k). Disk tabs keep a
  // constant key, so unlocking a container never re-acquires them.
  const lockedSessionKey =
    tab.source?.kind === "virtual"
      ? `${lockedSession?.session_id ?? ""}:${lockedSession?.revision ?? 0}`
      : "";
  const lockedAtRoot =
    lockedSource !== null &&
    lockedSession !== undefined &&
    lockedSession !== null &&
    lockedSource.container_path.replace(/^\\\\\?\\/, "").toLowerCase() ===
      lockedSession.container_path.replace(/^\\\\\?\\/, "").toLowerCase() &&
    lockedSource.entry_id.toLowerCase() === lockedSession.container_id.toLowerCase();
  // Any shared-document presenter uses the DocumentRegistry handle; editable
  // handlers additionally acquire their one editor controller up front. SVG
  // is markup, not raster data, so it always stays on the read-only image
  // viewer.
  const svgReadOnly = path.toLowerCase().endsWith(".svg");
  const VirtualView = handler?.virtualView !== undefined && !svgReadOnly ? handler.virtualView : null;
  const registerSaveRef = useRef(registerSave);
  registerSaveRef.current = registerSave;
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<FileTabStatus>({ items: [] });
  // One extraction review replaces this tab's viewer until it closes (17d).
  const [extractionReviewId, setExtractionReviewId] = useState<string | null>(null);
  // Which saved status order applies to this viewer's file kind.
  const handlerId = handler?.id ?? "";
  const statusKind: StatusKind =
    handlerId === "pdf"
      ? "pdf"
      : handlerId === "image" || handlerId === "codecImage"
        ? "image"
        : handlerId === "media"
          ? "media"
          : handlerId.startsWith("office")
            ? "office"
            : "text";
  const statusOrder = statusCustomization?.orders[statusKind] ?? [];
  const statusVisible = statusCustomization?.visible ?? true;
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
  // Handlers that present a shared document (Step 09a) get one handle per
  // view; the model and its unsaved changes live in DocumentRegistry.
  const [documentHandle, setDocumentHandle] = useState<DocumentHandle | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const captureOptions = recovery ?? DEFAULT_RECOVERY_CAPTURE;
  const showRecoveryWarning = useCallback(
    (code: string) => {
      setRecoveryNotice(
        code === "recovery.sensitive"
          ? t("recovery.sensitive")
          : code === "recovery.too_large"
            ? t("errors.recovery.too_large")
            : code === "recovery.io"
              ? t("errors.recovery.io")
              : t("errors.recovery.unsupported"),
      );
    },
    [t],
  );
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
    if (!isTauriRuntime() || !path || draftDocument) return;
    let cancelled = false;
    let token: string | null = null;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        // Restore concurrency is window-wide: normal and split leaves take
        // slots from the same budget (Step 09i D7).
        const opened = async () => {
          const info = await fileDetect(path);
          const granted = await fileGrant(path);
          return { info, granted };
        };
        const { info, granted } = openBudget ? await openBudget.run(opened) : await opened();
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
  }, [path, reloadKey, openBudget, draftDocument, t]);

  // A document presenter (image project, media recipe, later Office/editors)
  // is fed by the shared DocumentRegistry, never by a fabricated path.
  useEffect(() => {
    if (
      !VirtualView ||
      tab.draft ||
      tab.source?.kind === "draft" ||
      (tab.source?.kind === "virtual" && tab.document_id !== "locked-virtual-file")
    ) {
      setDocumentHandle(null);
      setDocumentError(null);
      return;
    }
    if (tab.source?.kind !== "virtual" && (!path || !isTauriRuntime())) return;
    if (tab.source?.kind === "virtual" && !isTauriRuntime()) return;
    // A virtual source has no bytes until its container's session is live.
    // A tab restored before unlock waits here; the session key below re-runs
    // this effect once the session appears instead of failing the acquire.
    if (tab.source?.kind === "virtual" && !lockedSession) {
      setDocumentHandle(null);
      setDocumentError(null);
      return;
    }
    let cancelled = false;
    let acquired: DocumentHandle | null = null;
    let unsubscribe: (() => void) | null = null;
    setDocumentError(null);
    setDocumentHandle(null);
    void (async () => {
      try {
        const source = tab.source ?? { kind: "disk" as const, path };
        // Editable presenters share one document-owned controller when the
        // startup composition registered its factory (Step 09a); without a
        // factory the view still gets a plain document handle.
        const editorHandlerId =
          handler && handler.editable === true && documentControllerFactory(handler.id)
            ? handler.id
            : null;
        const acquiredDocument = async () =>
          editorHandlerId
            ? await DocumentRegistry.acquireEditor(source, editorHandlerId)
            : await DocumentRegistry.acquire(source);
        acquired = openBudget ? await openBudget.run(acquiredDocument) : await acquiredDocument();
        if (cancelled) {
          DocumentRegistry.release(acquired.id);
          acquired = null;
          return;
        }
        const currentHandle = acquired;
        setDocumentHandle(currentHandle);
        dirtyRef.current?.(currentHandle.getState().dirty);
        unsubscribe = currentHandle.subscribe((state) => dirtyRef.current?.(state.dirty));
        registerSaveRef.current?.({
          // A virtual document cannot Save in place. "Save" in the generic
          // unsaved dialog asks the locked close policy for its one explicit
          // choice instead of calling the refusing native save.
          save: () =>
            currentHandle.source.kind === "virtual"
              ? prepareDocumentClose([currentHandle], "tab")
              : currentHandle.save(),
          discard: () => {
            void currentHandle.discard();
          },
        });
      } catch (error) {
        if (!cancelled) setDocumentError(errorText(t, error, "documents"));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      registerSaveRef.current?.(null);
      if (acquired) DocumentRegistry.release(acquired.id);
    };
    // The path is the document identity; callback identities are kept in refs.
    // A virtual tab also follows the live session and its container revision,
    // so a stale lease is released and re-acquired exactly once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler?.id, path, tab.source?.kind, tab.document_id, lockedSessionKey, openBudget, t]);

  // An in-memory recipe draft brings its own handle. It has no provider row
  // in DocumentRegistry and is never acquired from a path.
  useEffect(() => {
    const handle = tab.draft;
    if (!handle) return;
    setDocumentError(null);
    setDocumentHandle(handle);
    dirtyRef.current?.(handle.getState().dirty);
    const unsubscribe = handle.subscribe((state) => dirtyRef.current?.(state.dirty));
    registerSaveRef.current?.({
      save: () => handle.save(),
      discard: () => {
        void handle.discard();
      },
    });
    return () => {
      unsubscribe();
      registerSaveRef.current?.(null);
    };
  }, [tab.draft]);

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

  // The in-memory recipe draft (Step 15 "Edit media") has no file path and
  // no shared registry row; it shows the same document presenter over its
  // own handle and keeps the source media tab untouched.
  if (draftDocument) {
    const DraftView = VirtualView;
    const handle = documentHandle ?? draftDocument;
    return (
      <div className="adp-filetab" hidden={!visible}>
        <div className="adp-filetab-nav">
          <span>{tab.title ?? draftDocument.info.name}</span>
          <HelpButton onOpenHelp={() => onOpenHelp(handler?.helpSlug ?? "media-trimming")} />
        </div>
        <div className="adp-filetab-body">
          <TabErrorBoundary onReload={() => undefined} onClose={onClose}>
            {DraftView ? (
              <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
                <DraftView
                  document={handle}
                  active={active}
                  savedState={isSerializableViewState(tab.view) ? tab.view : null}
                  onStateChange={onViewState}
                  onStatus={setStatus}
                  find={viewFind}
                  previewOnly={false}
                  onOpenHelp={onOpenHelp}
                />
              </Suspense>
            ) : (
              <div className="adp-viewer-message" role="alert">
                <p>{t("tabs.handlerMissing")}</p>
              </div>
            )}
          </TabErrorBoundary>
        </div>
        <footer className="adp-statusbar adp-filetab-status">
          <StatusFieldHost
            registry={statusFields}
            ownerId={`file:${tab.id}`}
            order={statusOrder}
            visible={statusVisible}
            legacyItems={status.items}
          />
        </footer>
      </div>
    );
  }

  // A virtual source never follows the disk path pipeline (Step 09k). The
  // container root browses entries; a supported entry opens as a document
  // through the same shared handle a disk presenter would use.
  if (lockedSource) {
    if (!lockedSession) {
      return (
        <div className="adp-filetab" hidden={!visible}>
          <div className="adp-viewer-message" role="alert">
            <FileQuestion size={32} aria-hidden="true" />
            <p>{t("errors.locked.locked")}</p>
            <Button onClick={onClose}>{t("tabs.close")}</Button>
          </div>
        </div>
      );
    }
    const liveSession = lockedSession;
    const parentId = lockedAtRoot ? null : lockedSource.entry_id;
    const openLockedEntry = async (entryId: string): Promise<void> => {
      const info = await lockedEntryInfo(liveSession.session_id, entryId);
      if (info.kind === "folder") {
        onLockedNavigate?.(tab.id, entryId);
        return;
      }
      if (!virtualPresenterFor({ mime: info.mime, ext: extensionOf(info.name) })) {
        throw new Error("locked.unsupported");
      }
      if (!onOpenLockedEntry) throw new Error("locked.unsupported");
      onOpenLockedEntry(lockedSource, entryId);
    };
    if (lockedBrowser) {
      return (
        <div className="adp-filetab" hidden={!visible}>
          <LockedFolderView
            session={liveSession}
            parentId={parentId}
            active={active}
            onOpenEntry={openLockedEntry}
            onSessionChange={(next) => onLockedSessionChange?.(next)}
            onOpenHelp={onOpenHelp}
            onNavigateRoot={() => onLockedNavigate?.(tab.id, liveSession.container_id)}
            onExportEntry={onLockedExportEntry}
            onOpenRecovery={liveSession.pending_recovery ? onLockedRecovery : undefined}
          />
        </div>
      );
    }
    return (
      <div className="adp-filetab" hidden={!visible}>
        <div className="adp-filetab-nav">
          <IconButton
            icon={ArrowUp}
            labelKey="locked.title"
            onClick={() => onLockedNavigate?.(tab.id, liveSession.container_id)}
          />
          <span>{t("locked.title")}</span>
          <HelpButton onOpenHelp={() => onOpenHelp("locked-folders")} />
        </div>
        <div className="adp-filetab-body">
          {documentError ? (
            <div className="adp-viewer-message" role="alert">
              <p>{documentError}</p>
              <Button onClick={onClose}>{t("tabs.close")}</Button>
            </div>
          ) : documentHandle && VirtualView ? (
            <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
              <VirtualView
                document={documentHandle}
                active={active}
                savedState={isSerializableViewState(tab.view) ? tab.view : null}
                onStateChange={onViewState}
                onStatus={setStatus}
                find={viewFind}
                previewOnly={protectedView}
                onOpenHelp={onOpenHelp}
              />
            </Suspense>
          ) : (
            <Skeleton variant="tiles" count={1} />
          )}
        </div>
        <footer className="adp-statusbar adp-filetab-status">
          <StatusFieldHost
            registry={statusFields}
            ownerId={`file:${tab.id}`}
            order={statusOrder}
            visible={statusVisible}
            legacyItems={status.items}
          />
        </footer>
      </div>
    );
  }
  return (
    <div className="adp-filetab" hidden={!visible}>
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
        {phase.kind === "ready" ? (
          <Suspense fallback={null}>
          <AiActionsLauncher
            trigger="icon"
            items={[{ path, name: phase.info.name }]}
            inputKind={
              handler?.id === "image" || handler?.id === "image-project" ? "image" : null
            }
            token={handler?.id === "image-project" ? null : phase.token}
            documentId={documentHandle?.id ?? null}
            expectedContentId={documentHandle ? documentHandle.getState().content_id : null}
            captureSnapshot={documentHandle ? () => documentHandle.captureSnapshot() : undefined}
            sourceSizeFor={
              documentHandle && (handler?.id === "image" || handler?.id === "image-project")
                ? async () => {
                    const module = await import("../image-edit/ImageDocument");
                    const model = module.getImageEditorModel(documentHandle.id);
                    return model ? { width: model.width, height: model.height } : null;
                  }
                : undefined
            }
            ocrLanguage={ocrLanguage}
            onOpenHelp={onOpenHelp}
            onNotify={(message) => setStatus({ items: [message] })}
          />
          </Suspense>
        ) : null}
        {phase.kind === "ready" && canExtract ? (
          <Suspense fallback={null}>
            <ExtractionLauncher
              items={[{ path, name: phase.info.name, token: phase.token }]}
              documentId={documentHandle?.id ?? null}
              captureSnapshot={documentHandle ? () => documentHandle.captureSnapshot() : undefined}
              ocrLanguage={ocrLanguage}
              onOpenHelp={onOpenHelp}
              onNotify={(message) => setStatus({ items: [message] })}
              onOpenReview={setExtractionReviewId}
              disabled={extractionReviewId !== null}
            />
          </Suspense>
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
        {extractionReviewId ? (
          <TabErrorBoundary onReload={() => void reload()} onClose={onClose}>
            <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
              <ExtractionReviewHost
                reviewId={extractionReviewId}
                defaultName={(phase.kind === "ready" ? phase.info.name : tab.title ?? "review").replace(/\.[^.]+$/, "")}
                onClose={() => setExtractionReviewId(null)}
                onOpenHelp={onOpenHelp}
                onOpenFile={onOpenFile}
                onNotify={(message) => setStatus({ items: [message] })}
              />
            </Suspense>
          </TabErrorBoundary>
        ) : (
        <>
        {/* Outside the boundary: a crashed view must not stop recovery of its
            unsaved document; the registry lease lives with the tab. */}
        {VirtualView && documentHandle && handler?.editable === true ? (
          <DocumentRecoveryCapture
            document={documentHandle}
            options={captureOptions}
            onWarning={showRecoveryWarning}
          />
        ) : null}
        <TabErrorBoundary onReload={() => void reload()} onClose={onClose}>
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
        {phase.kind === "ready" && !handler ? (
          <div className="adp-viewer-message" role="alert">
            <FileQuestion size={32} aria-hidden="true" />
            <p>{t("tabs.handlerMissing")}</p>
            <div className="adp-dialog-actions">
              {path ? <Button onClick={() => onShowInFolder(path)}>{t("tabs.locate")}</Button> : null}
              <Button onClick={onClose}>{t("tabs.close")}</Button>
            </div>
          </div>
        ) : null}
        {phase.kind === "ready" && VirtualView ? (
          documentError ? (
            <div className="adp-viewer-message" role="alert">
              <p>{documentError}</p>
              <Button onClick={onClose}>{t("tabs.close")}</Button>
            </div>
          ) : documentHandle ? (
            <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
              <VirtualView
                document={documentHandle}
                active={active}
                savedState={isSerializableViewState(tab.view) ? tab.view : null}
                onStateChange={onViewState}
                onStatus={setStatus}
                find={viewFind}
                previewOnly={protectedView}
                onOpenHelp={onOpenHelp}
                onOpenInWindowsApp={
                  path && documentHandle.source.kind === "disk" && !documentHandle.info.sensitive
                    ? openInWindowsApp
                    : undefined
                }
              />
            </Suspense>
          ) : (
            <Skeleton variant="tiles" count={1} />
          )
        ) : null}
        {phase.kind === "ready" && handler && !VirtualView ? (
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
              onEditMedia={onEditMedia}
              ocrLanguage={ocrLanguage}
              documentId={tab.document_id}
              syncViewId={syncViewId ?? tab.id}
              onOpenHelp={onOpenHelp}
            />
          </Suspense>
        ) : null}
        </TabErrorBoundary>
        </>
        )}
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
        <StatusFieldHost
          registry={statusFields}
          ownerId={`file:${tab.id}`}
          order={statusOrder}
          visible={statusVisible}
          legacyItems={status.items}
          critical={recoveryNotice ? <span role="status">{recoveryNotice}</span> : undefined}
        />
        {statusVisible && status.zoom ? (
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
