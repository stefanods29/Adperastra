import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import { errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import {
  listSavedSearches,
  search,
  type SavedSearch,
  type SearchPage,
} from "../services/search";
import type { SmartFolder } from "../services/smartViews";
import { viewErrorText } from "./useIndexedViewPage";
import ViewResultList from "./ViewResultList";

export interface SmartFolderViewProps {
  folder: SmartFolder;
  active: boolean;
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
}

/** A smart folder runs its saved search against the live index. The query is
 * read-only: this view is never a copy or paste destination. */
export default function SmartFolderView({
  folder,
  active,
  onOpenFile,
  onOpenHelp,
}: SmartFolderViewProps) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let handle: JobHandle<SearchPage> | null = null;
    setLoading(true);
    setError(null);
    setPage(null);
    (async () => {
      const searches = await listSavedSearches();
      if (disposed) return;
      const found = searches.find((entry) => entry.id === folder.saved_search_id) ?? null;
      setSaved(found);
      if (!found) {
        setError("views.invalid");
        return;
      }
      const started = await search(found.query);
      handle = started;
      if (disposed) {
        void started.cancel();
        return;
      }
      const result = await started.completion;
      if (!disposed) setPage(result);
    })()
      .catch((caught: unknown) => {
        if (!disposed) setError(typeof caught === "string" ? caught : "views.unavailable");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      void handle?.cancel();
    };
  }, [active, folder.saved_search_id, nonce]);

  const message = error
    ? error.startsWith("search.")
      ? errorText(t, error, "search")
      : viewErrorText(t, error)
    : null;

  return (
    <section
      className="adp-view adp-smart-folder"
      aria-label={folder.name}
      aria-busy={loading}
      data-smart-folder-id={folder.id}
    >
      <header className="adp-view-header">
        <h2 className="adp-view-title">{folder.name}</h2>
        <Button variant="subtle" onClick={() => setNonce((value) => value + 1)}>
          {t("commands.refresh")}
        </Button>
        <HelpButton onOpenHelp={onOpenHelp} />
      </header>
      <p className="adp-smart-query" aria-readonly="true" title={t("smartFolders.notDestination")}>
        {saved ? saved.query.text || t(`search.${saved.query.mode}`) : t("search.title")}
      </p>
      <p className="adp-view-note">{t("smartFolders.notDestination")}</p>
      {message ? (
        <p className="adp-view-error" role="alert">
          {message}
        </p>
      ) : null}
      {loading ? <p className="adp-view-loading">{t("search.loading")}</p> : null}
      <ViewResultList results={page?.results ?? []} onOpenFile={onOpenFile} />
      {!loading && !message && (page?.results.length ?? 0) === 0 ? (
        <p className="adp-view-empty">{t("search.empty")}</p>
      ) : null}
    </section>
  );
}
