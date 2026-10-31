import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { extractRequestFor } from "../../archive/archiveFiles";
import { resolveMenu } from "../../commands/menus";
import type { Command } from "../../commands/registry";
import Breadcrumb from "../../components/Breadcrumb";
import Button from "../../components/Button";
import Menu from "../../components/Menu";
import ProgressBar from "../../components/ProgressBar";
import Skeleton from "../../components/Skeleton";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { archiveOpenEntry, archivePickFolder, type ArchiveSummary } from "../../services/archive";
import { errorCode, errorText } from "../../services/errors";
import type { OpProgress } from "../../services/fileops";
import { formatSize } from "../../services/format";
import { EMPTY_SELECTION, selectOnly, type SelectionState } from "../../services/selection";
import FileList from "../../views/explorer/FileList";
import type { HandlerViewProps } from "../types";
import {
  ARCHIVE_BACKGROUND_MENU,
  ARCHIVE_ITEM_MENU,
  ARCHIVE_RIBBON,
  createArchiveCommands,
  type ArchiveActions,
  type ArchiveCtx,
} from "./archiveCommands";
import { archiveTypeLabel, breadcrumbSegments, parentFolder, toExplorerItem } from "./archiveItems";
import { useArchiveSession } from "./useArchiveSession";

/** What the strip below the list says right now. */
type Strip =
  | { kind: "opening"; name: string; progress: OpProgress | null; visible: boolean }
  | { kind: "notice"; text: string };

/** An archive in a file tab (Step 06d D3): the Explorer's Details list, a
 * path bar, a search box and a ribbon. Double-clicking a file copies it out
 * and opens it in a new tab; extraction goes to the Explorer's jobs. */
export default function ArchiveView(props: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const { info, active, find, onStatus, onOpenInWindowsApp, onOpenFile, onExtractArchive } = props;
  const archive = useArchiveSession(info.path);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openEntryRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<{ x: number; y: number; item: string | null } | null>(null);
  const [strip, setStrip] = useState<Strip | null>(null);
  const [busy, setBusy] = useState(false);
  const [asideSearch, setAsideSearch] = useState<string | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showReading, setShowReading] = useState(false);

  const phase = archive.phase;
  const summary: ArchiveSummary | null = phase.kind === "ready" ? phase.summary : null;
  const searchedText = find.text.trim();
  const searching = searchedText !== "" && searchedText !== asideSearch;

  // Search the whole archive after the user stops typing.
  useEffect(() => {
    archive.search(searching ? searchedText : "");
    // `archive.search` is stable; only the text decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedText, searching]);

  const shownPage = searching ? archive.results : archive.page;
  const items = useMemo(() => (shownPage?.items ?? []).map(toExplorerItem), [shownPage]);
  const itemByPath = useMemo(() => new Map(items.map((item) => [item.path, item])), [items]);
  const single = selection.focus !== null ? (itemByPath.get(selection.focus) ?? null) : null;
  const singleArchiveItem = single
    ? ((shownPage?.items ?? []).find((item) => item.path === single.path) ?? null)
    : null;
  const selectedPaths = useMemo(
    () => items.filter((item) => selection.selected.has(item.path)).map((item) => item.path),
    [items, selection.selected],
  );

  // Loading: nothing for 100 ms, then rows, then words after a second.
  useEffect(() => {
    if (phase.kind !== "loading") {
      setShowSkeleton(false);
      setShowReading(false);
      return;
    }
    const skeleton = window.setTimeout(() => setShowSkeleton(true), 100);
    const reading = window.setTimeout(() => setShowReading(true), 1_000);
    return () => {
      window.clearTimeout(skeleton);
      window.clearTimeout(reading);
    };
  }, [phase.kind]);

  // The next search match (F3 / Enter in the search box).
  useEffect(() => {
    if (find.request === 0 || items.length === 0) return;
    const item = items[find.request % items.length];
    setSelection(selectOnly(item.path));
    // Only a new request moves the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.request]);

  // The list gets the keyboard when the tab is shown.
  useEffect(() => {
    if (!active || phase.kind !== "ready") return;
    rootRef.current?.querySelector<HTMLElement>(".adp-filelist-scroll")?.focus({ preventScroll: true });
  }, [active, phase.kind]);

  const openArchiveItem = useCallback(
    (path: string) => {
      const entry = (shownPage?.items ?? []).find((item) => item.path === path);
      if (!entry) return;
      if (entry.kind === "folder") {
        setAsideSearch(searchedText);
        archive.setFolder(entry.path);
        setSelection(EMPTY_SELECTION);
        return;
      }
      if (entry.kind === "link") {
        setStrip({ kind: "notice", text: t("archive.linkCannotOpen") });
        return;
      }
      if (entry.encrypted) {
        setStrip({
          kind: "notice",
          text: errorText(t, new Error("archive.password_required"), "archive"),
        });
        return;
      }
      if (!onOpenFile || busy) return;
      setBusy(true);
      setStrip({ kind: "opening", name: entry.name, progress: null, visible: false });
      const reveal = window.setTimeout(() => {
        setStrip((current) =>
          current && current.kind === "opening" ? { ...current, visible: true } : current,
        );
      }, 150);
      void (async () => {
        try {
          const job = await archiveOpenEntry(
            {
              archive: info.path,
              inner_path: entry.path,
              expected_size: entry.size,
              expected_modified: entry.modified_unix,
            },
            (progress) =>
              setStrip((current) =>
                current && current.kind === "opening" ? { ...current, progress } : current,
              ),
          );
          openEntryRef.current = job;
          const opened = await job.completion;
          openEntryRef.current = null;
          setStrip(null);
          try {
            await onOpenFile(opened.path);
          } catch (error) {
            setStrip({ kind: "notice", text: errorText(t, error, "files") });
          }
        } catch (error) {
          openEntryRef.current = null;
          if (errorCode(error) === "archive.cancelled") setStrip(null);
          else setStrip({ kind: "notice", text: errorText(t, error, "archive") });
        } finally {
          window.clearTimeout(reveal);
          setBusy(false);
        }
      })();
    },
    [archive, busy, info.path, onOpenFile, searchedText, shownPage, t],
  );

  const actions: ArchiveActions = useMemo(
    () => ({
      extractAll: () => {
        if (!onExtractArchive) return;
        const request = extractRequestFor(
          { path: info.path, size: info.size, modified_unix: info.modified_unix },
          "newFolder",
          null,
          t("files.extractedFolderName"),
        );
        if (summary?.temporary) {
          // Our own copy lives in the app's data folder: ask where to put it.
          void archivePickFolder(t("archive.pickFolderTitle"))
            .then((folder) => {
              if (folder) onExtractArchive({ ...request, dest_dir: folder });
            })
            .catch(() => undefined);
          return;
        }
        onExtractArchive(request);
      },
      extractSelected: () => {
        if (!onExtractArchive || selectedPaths.length === 0) return;
        void archivePickFolder(t("archive.pickFolderTitle"))
          .then((folder) => {
            if (!folder) return;
            onExtractArchive({
              archive: info.path,
              paths: [...selectedPaths],
              base: searching ? "" : archive.folder,
              dest_dir: folder,
              new_folder: null,
              expected_size: info.size,
              expected_modified: info.modified_unix,
            });
          })
          .catch(() => undefined);
      },
      openEntry: () => {
        if (single) openArchiveItem(single.path);
      },
      openLocation: () => {
        if (!single) return;
        setAsideSearch(searchedText);
        archive.setFolder(parentFolder(single.path));
        setSelection(selectOnly(single.path));
      },
      up: () => {
        archive.setFolder(parentFolder(archive.folder));
        setSelection(EMPTY_SELECTION);
      },
      refresh: () => archive.reload(),
    }),
    [
      archive,
      info.modified_unix,
      info.path,
      info.size,
      onExtractArchive,
      openArchiveItem,
      searchedText,
      searching,
      selectedPaths,
      single,
      summary?.temporary,
      t,
    ],
  );

  const commands = useMemo(() => createArchiveCommands(actions), [actions]);
  const commandById = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  const lookup = useCallback((id: string) => commandById.get(id), [commandById]);
  const ctx: ArchiveCtx = {
    ready: phase.kind === "ready",
    canExtract: onExtractArchive !== undefined,
    files: summary?.files ?? 0,
    selectedCount: selectedPaths.length,
    single: singleArchiveItem,
    folder: archive.folder,
    searching,
    busy,
    loading: phase.kind === "loading",
  };
  useCommandShortcuts(commands, ctx, active);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    const total = shownPage?.total ?? 0;
    const parts = [t("archive.statusItems", { count: total })];
    if (summary) {
      parts.push(
        t("archive.statusFiles", {
          count: summary.files,
          size: formatSize(summary.total_size, i18n.language),
        }),
      );
      parts.push(t(`archive.format.${summary.format}`));
    }
    onStatusRef.current({ items: parts });
  }, [shownPage?.total, summary, i18n.language, t]);

  const notes: string[] = [];
  if (summary?.partial) notes.push(t("archive.partialNote"));
  if ((summary?.hidden_entries ?? 0) > 0) {
    notes.push(t("archive.hiddenNote", { count: summary?.hidden_entries ?? 0 }));
  }
  if ((summary?.encrypted_entries ?? 0) > 0) {
    notes.push(t("archive.encryptedNote", { count: summary?.encrypted_entries ?? 0 }));
  }
  if (shownPage?.truncated && !searching) {
    notes.push(t("archive.truncated", { count: shownPage.items.length }));
  }
  if (shownPage?.truncated && searching) {
    notes.push(t("archive.searchTruncated", { count: shownPage.items.length }));
  }

  const percent = (progress: OpProgress | null): number | undefined =>
    progress && progress.bytes_total > 0
      ? Math.floor((progress.bytes_done / progress.bytes_total) * 100)
      : undefined;

  const body = () => {
    if (phase.kind === "loading") {
      return (
        <div className="adp-archive-body">
          {showSkeleton ? <Skeleton variant="rows" count={8} /> : null}
          {showReading ? (
            <p className="adp-archive-reading">
              {phase.progress && phase.progress.bytes_total > 0
                ? t("archive.readingPercent", { percent: percent(phase.progress) ?? 0 })
                : t("archive.reading")}
            </p>
          ) : null}
          {showReading ? <Button onClick={archive.cancelOpen}>{t("common.cancel")}</Button> : null}
        </div>
      );
    }
    if (phase.kind === "error") {
      return (
        <div className="adp-archive-body">
          <div className="adp-viewer-message" role="alert">
            <p>{errorText(t, phase.error, "archive")}</p>
            <Button variant="primary" onClick={onOpenInWindowsApp}>
              {t("fileTab.openInWindowsApp")}
            </Button>
          </div>
        </div>
      );
    }
    if (phase.kind === "cancelled") {
      return (
        <div className="adp-archive-body">
          <div className="adp-viewer-message" role="status">
            <p>{t("archive.readCancelled")}</p>
            <Button onClick={archive.reload}>{t("archive.tryAgain")}</Button>
          </div>
        </div>
      );
    }
    return (
      <div className="adp-archive-body">
        {shownPage === null ? null : items.length === 0 ? (
          <p className="adp-archive-empty">
            {searching
              ? t("archive.noMatches", { text: searchedText })
              : archive.folder === ""
                ? t("archive.emptyArchive")
                : t("archive.emptyFolder")}
          </p>
        ) : (
          <FileList
            items={items}
            groups={null}
            selection={selection}
            onSelectionChange={setSelection}
            sortKey={archive.sort.key}
            sortDirection={archive.sort.direction}
            onSort={archive.setSort}
            showExtensions
            checkboxes={false}
            typeLabel={(item) => archiveTypeLabel(t, item)}
            renamingPath={null}
            onStartRename={() => undefined}
            onRenameCommit={async () => null}
            onRenameCancel={() => undefined}
            onOpen={(item) => openArchiveItem(item.path)}
            onContextMenu={(point, item) =>
              setMenu({ x: point.x, y: point.y, item: item?.path ?? null })
            }
            onCommandKey={(commandId) => {
              if (commandId === "explorer.open" && single) openArchiveItem(single.path);
            }}
            label={t("archive.listLabel", { name: info.name })}
          />
        )}
      </div>
    );
  };

  return (
    <ViewerFrame
      ribbon={
        <Ribbon def={ARCHIVE_RIBBON} ctx={ctx} commands={commands} accent="explorer" active={active} />
      }
    >
      <div ref={rootRef} className="adp-archive">
        <nav className="adp-archive-bar" aria-label={t("archive.pathLabel")}>
          <Breadcrumb
            segments={breadcrumbSegments(info.name, archive.folder)}
            onNavigate={(id) => {
              setAsideSearch(searchedText);
              archive.setFolder(id);
              setSelection(EMPTY_SELECTION);
            }}
          />
          {searching ? (
            <span className="adp-archive-searchnote">{t("archive.searchNote")}</span>
          ) : null}
        </nav>
        {notes.map((note) => (
          <div key={note} className="adp-archive-note" role="status">
            {note}
          </div>
        ))}
        {body()}
        {strip ? (
          <div className="adp-archive-strip" role="status">
            {strip.kind === "opening" ? (
              <>
                <span>{t("archive.opening", { name: strip.name })}</span>
                {strip.visible ? (
                  <>
                    <ProgressBar
                      value={percent(strip.progress)}
                      label={t("archive.opening", { name: strip.name })}
                    />
                    <Button
                      onClick={() => {
                        void openEntryRef.current?.cancel();
                        setStrip(null);
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <span>{strip.text}</span>
                <Button onClick={() => setStrip(null)}>{t("common.dismiss")}</Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {menu ? (
        <Menu
          entries={resolveMenu(menu.item ? ARCHIVE_ITEM_MENU : ARCHIVE_BACKGROUND_MENU, ctx, lookup)}
          ctx={ctx}
          lookup={lookup}
          anchor={{ kind: "point", x: menu.x, y: menu.y }}
          onRun={(command: Command<ArchiveCtx>) => command.run(ctx)}
          onClose={() => setMenu(null)}
          ariaLabel={t("archive.pathLabel")}
        />
      ) : null}
    </ViewerFrame>
  );
}
