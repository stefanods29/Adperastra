import { Filter, Save, Search as SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import Skeleton from "../components/Skeleton";
import TextInput from "../components/TextInput";
import { errorCode, errorText } from "../services/errors";
import type { FolderPresentation } from "../services/folderPresentation";
import type { ExplorerItem } from "../services/explorer";
import type { JobHandle } from "../services/jobs";
import {
  cancelSearch,
  saveSearch,
  search as startSearch,
  searchPage,
  type IndexRoot,
  type SavedSearch,
  type SearchPage,
  type SearchQuery,
} from "../services/search";
import { EMPTY_SELECTION, type SelectionState } from "../services/selection";
import ItemView from "../views/explorer/views/ItemView";
import type { ItemViewProps } from "../views/explorer/views/useItemInteractions";
import FilterBuilder, { type FilterDraft } from "./FilterBuilder";
import SearchModePicker from "./SearchModePicker";
import { nextSearchMode, parseSearchInput } from "./queryParsing";

export interface SearchResultsViewProps {
  query: SearchQuery;
  viewFolderPresentation: FolderPresentation;
  active: boolean;
  onOpenFile: (path: string) => Promise<void>;
  onQueryChange: (query: SearchQuery) => void;
  onOpenHelp: (slug: string) => void;
  /** Additive integration input; the folder filter can name indexed roots. */
  indexRoots?: IndexRoot[];
  /** Additive integration output; a newly saved query joins the saved list. */
  onSaved?: () => void;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function typeLabelFor(
  item: ExplorerItem,
  folderLabel: string,
  genericLabel: string,
  fileLabel: (ext: string) => string,
): string {
  if (item.kind === "folder") return folderLabel;
  const extension = item.name.includes(".") ? item.name.split(".").pop()?.toUpperCase() ?? "" : "";
  return extension ? fileLabel(extension) : genericLabel;
}

/** Search results reuse the ordinary Explorer item views, selection rules and
 * open path. Results are real disk paths, never index IDs. */
export default function SearchResultsView({
  query,
  viewFolderPresentation,
  active,
  onOpenFile,
  onQueryChange,
  onOpenHelp,
  indexRoots,
  onSaved,
}: SearchResultsViewProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState(query.text);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(false);
  const [prefixNotice, setPrefixNotice] = useState("");
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [filterOpen, setFilterOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const job = useRef<JobHandle<SearchPage> | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  /** The text most recently sent, so an external query change resets the box
   * without erasing a prefix the user is still typing. */
  const sentText = useRef(query.text);
  const searchInput = useRef<HTMLInputElement>(null);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (query.text !== sentText.current) {
      sentText.current = query.text;
      setInput(query.text);
    }
  }, [query.text]);

  /** Stop the running job and invalidate every answer it could still send.
   * Native cancellation reports `search.changed`, so the generation check is
   * what keeps Escape from looking like a changed index. */
  const cancelRun = () => {
    generation.current += 1;
    const handle = job.current;
    job.current = null;
    if (handle) void cancelSearch(handle);
    setBusy(false);
    setLoading(false);
  };

  useEffect(() => {
    if (!active) return;
    const current = generation.current + 1;
    generation.current = current;
    setPage(null);
    setSelection(EMPTY_SELECTION);
    setLoading(true);
    setBusy(false);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const handle = await startSearch(queryRef.current);
        if (generation.current !== current) {
          void handle.cancel();
          return;
        }
        job.current = handle;
        const result = await handle.completion;
        if (generation.current !== current) return;
        job.current = null;
        setPage(result);
        setLoading(false);
      } catch (reason) {
        if (generation.current !== current) return;
        job.current = null;
        setLoading(false);
        if (errorCode(reason) === "search.changed") {
          setUpdated(true);
          setReloadKey((value) => value + 1);
        } else {
          setError(errorText(t, reason, "search"));
        }
      }
    }, 30);
    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
      const handle = job.current;
      job.current = null;
      if (handle) void handle.cancel();
    };
  }, [queryKey, active, reloadKey, t]);

  useEffect(() => {
    if (active) searchInput.current?.focus();
  }, [active]);

  const items = useMemo(() => page?.results.map((result) => result.item) ?? [], [page]);

  const changeQuery = (next: SearchQuery) => {
    setUpdated(false);
    onQueryChange(next);
  };

  const changeInput = (value: string) => {
    setInput(value);
    setPrefixNotice("");
    const parsed = parseSearchInput(value, query.mode);
    if (parsed.disabled_mode) {
      // An AI-looking prefix explains its setup and never starts a search or
      // a network request, even before Enter is pressed.
      setPrefixNotice(t("search.aiUnavailable"));
      return;
    }
    // A prefix chooses the mode and is stripped from the query as soon as it
    // is typed, so results never describe the literal prefix text.
    const nextMode = parsed.mode ?? query.mode;
    const nextText = parsed.mode ? parsed.text : value;
    sentText.current = nextText;
    if (nextMode !== query.mode || nextText !== query.text) {
      changeQuery({ ...query, mode: nextMode, text: nextText });
    }
  };

  const chooseMode = (mode: SearchQuery["mode"]) => {
    if (mode === query.mode) return;
    setPrefixNotice("");
    sentText.current = query.text;
    setInput(query.text);
    changeQuery({ ...query, mode });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && event.ctrlKey) {
      event.preventDefault();
      chooseMode(nextSearchMode(query.mode));
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      onOpenHelp("searching");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRun();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseSearchInput(input, query.mode);
      if (parsed.disabled_mode) {
        setPrefixNotice(t("search.aiUnavailable"));
        return;
      }
      setPrefixNotice("");
      const nextMode = parsed.mode ?? query.mode;
      sentText.current = parsed.text;
      setInput(parsed.text);
      if (nextMode === query.mode && parsed.text === query.text) {
        // Enter asks for the same query again, even after Escape cancelled it.
        setUpdated(false);
        setReloadKey((value) => value + 1);
      } else {
        changeQuery({
          ...query,
          mode: nextMode,
          text: parsed.text,
        });
      }
    }
  };

  const loadMore = async () => {
    const currentPage = page;
    if (!currentPage?.next_cursor || busy) return;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const handle = await searchPage(currentPage.next_cursor);
      if (generation.current !== current) {
        void handle.cancel();
        return;
      }
      job.current = handle;
      const next = await handle.completion;
      if (generation.current !== current) return;
      job.current = null;
      setPage({
        ...next,
        results: [...currentPage.results, ...next.results],
      });
    } catch (reason) {
      if (generation.current !== current) return;
      job.current = null;
      if (errorCode(reason) === "search.changed") {
        setUpdated(true);
        setReloadKey((value) => value + 1);
      } else {
        setError(errorText(t, reason, "search"));
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const name = saveName.trim();
    if (!name) return;
    const saved: SavedSearch = {
      id: newId(),
      name,
      query,
      created_unix: Math.floor(Date.now() / 1000),
      modified_unix: Math.floor(Date.now() / 1000),
      version: 1,
    };
    setBusy(true);
    setError("");
    try {
      await saveSearch(saved);
      setSaveOpen(false);
      setSaveName("");
      onSaved?.();
    } catch (reason) {
      setError(errorText(t, reason, "search"));
    } finally {
      setBusy(false);
    }
  };

  const openItem = (item: ExplorerItem) => {
    void onOpenFile(item.path);
  };

  const viewProps: ItemViewProps = {
    active,
    items,
    groups: null,
    selection,
    onSelectionChange: setSelection,
    sortKey: query.sort.key,
    sortDirection: query.sort.direction,
    onSort: (key) =>
      changeQuery({
        ...query,
        // A column sort replaces any indexed Timeline ordering.
        sort_date: null,
        sort: {
          key,
          direction:
            query.sort.key === key && query.sort.direction === "ascending"
              ? "descending"
              : "ascending",
        },
      }),
    showExtensions: true,
    checkboxes: false,
    typeLabel: (item) =>
      typeLabelFor(
        item,
        t("explorer.folderType"),
        t("explorer.genericFile"),
        (ext) => t("explorer.fileType", { ext }),
      ),
    renamingPath: null,
    onStartRename: () => undefined,
    onRenameCommit: async () => t("errors.search.failed"),
    onRenameCancel: () => undefined,
    onOpen: openItem,
    onContextMenu: () => undefined,
    onCommandKey: (commandId) => {
      if (commandId === "explorer.open" && selection.focus) {
        const focused = items.find((item) => item.path === selection.focus);
        if (focused) openItem(focused);
      }
    },
    label: t("search.title"),
  };

  const foundBy = page?.results[0]?.found_by ?? query.mode;
  const truncated = page?.results.some((result) => result.content_truncated) ?? false;
  const shortPrefix =
    query.mode === "name" && query.text.trim().length > 0 && query.text.trim().length <= 2;

  return (
    <section className="adp-search" aria-label={t("search.title")}>
      <div className="adp-search-bar">
        <SearchIcon size={16} aria-hidden="true" />
        <input
          ref={searchInput}
          className="adp-search-input"
          type="search"
          value={input}
          placeholder={t("search.searchBox")}
          aria-label={t("search.searchBox")}
          onChange={(event) => changeInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <SearchModePicker
          mode={query.mode}
          onChange={chooseMode}
          disabledReason={t("search.aiUnavailable")}
          onOpenHelp={onOpenHelp}
        />
        <button
          type="button"
          className="adp-btn"
          aria-pressed={query.mode === "filters"}
          onClick={() => setFilterOpen(true)}
        >
          <Filter size={16} aria-hidden="true" />
          {t("search.filters")}
        </button>
        <button
          type="button"
          className="adp-btn"
          onClick={() => {
            setSaveName("");
            setSaveOpen(true);
          }}
        >
          <Save size={16} aria-hidden="true" />
          {t("search.save")}
        </button>
      </div>

      {prefixNotice ? (
        <p className="adp-search-notice" role="status">
          {prefixNotice}
        </p>
      ) : null}
      {updated ? (
        <p className="adp-search-notice" role="status">
          {t("search.updated")}
        </p>
      ) : null}
      {page && page.coverage !== "complete" ? (
        <p className="adp-search-notice" role="status">
          {t("search.partial")}
        </p>
      ) : null}
      {shortPrefix ? (
        <p className="adp-search-notice" role="status">
          {t("search.prefixShort")}
        </p>
      ) : null}
      {truncated ? (
        <p className="adp-search-notice" role="status">
          {t("search.truncated")}
        </p>
      ) : null}

      <div className="adp-search-summary" aria-live="polite">
        {loading ? (
          <span>{t("search.loading")}</span>
        ) : page ? (
          <>
            {/* A regex page reports scanned rows, not matches; show a count
                only when the native page says it is an exact total. */}
            {page.total_exact ? (
              <span>{t("search.count", { count: page.total_estimate })}</span>
            ) : null}
            <span className="adp-search-found">
              {t("search.foundBy", { mode: t(`search.${foundBy}`) })}
            </span>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="adp-search-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !page ? <Skeleton variant="rows" count={6} /> : null}

      {!loading && page && page.results.length === 0 ? (
        <p className="adp-search-empty">{t("search.empty")}</p>
      ) : null}

      {page && page.results.length > 0 ? (
        <>
          <div className="adp-search-results">
            <ItemView mode={viewFolderPresentation.view_mode} {...viewProps} />
          </div>
          {page.next_cursor ? (
            <div className="adp-search-more">
              <button type="button" className="adp-btn" disabled={busy} onClick={() => void loadMore()}>
                {t("search.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {filterOpen ? (
        <FilterBuilder
          value={{ filter: query.filter ?? null, roots: query.roots }}
          roots={indexRoots ?? []}
          onChange={(draft: FilterDraft) => {
            changeQuery({ ...query, mode: "filters", filter: draft.filter, roots: draft.roots });
          }}
          onClose={() => setFilterOpen(false)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}

      {saveOpen ? (
        <Dialog title={t("search.save")} onClose={() => setSaveOpen(false)} className="adp-search-save-dialog">
          <label className="adp-field">
            <span>{t("search.savedName")}</span>
            <TextInput
              value={saveName}
              onChange={setSaveName}
              maxLength={60}
              ariaLabel={t("search.savedName")}
            />
          </label>
          <div className="adp-dialog-actions">
            <button type="button" className="adp-btn" onClick={() => setSaveOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="adp-btn adp-btn--primary" disabled={!saveName.trim() || busy} onClick={() => void save()}>
              {t("search.save")}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
