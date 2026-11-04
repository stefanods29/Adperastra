import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import type { SearchQuery } from "../services/search";
import {
  VIEW_KINDS,
  VIEW_KIND_LABEL_KEYS,
  type IndexedViewQuery,
  type ViewKind,
} from "../services/smartViews";
import { useIndexedViewPage, viewErrorText } from "./useIndexedViewPage";
import ViewResultList from "./ViewResultList";

export interface ByKindViewProps {
  query: SearchQuery;
  active: boolean;
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
}

export default function ByKindView({
  query,
  active,
  onOpenFile,
  onOpenHelp,
}: ByKindViewProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ViewKind | null>(null);
  const request = useMemo<IndexedViewQuery>(
    () => ({ view: "by_kind", query, kind }),
    [query, kind],
  );
  const { page, error, loading, loadingMore, reload, loadMore } = useIndexedViewPage(
    request,
    active,
  );
  const counts = useMemo(
    () => new Map((page?.buckets ?? []).map((bucket) => [bucket.id, bucket.count])),
    [page],
  );

  return (
    <section className="adp-view adp-by-kind" aria-label={t("views.byKind")} aria-busy={loading}>
      <header className="adp-view-header">
        <h2 className="adp-view-title">{t("views.byKind")}</h2>
        <Button variant="subtle" onClick={reload}>
          {t("commands.refresh")}
        </Button>
        <HelpButton onOpenHelp={onOpenHelp} />
      </header>
      {error ? (
        <p className="adp-view-error" role="alert">
          {viewErrorText(t, error)}
        </p>
      ) : null}
      {loading ? <p className="adp-view-loading">{t("search.loading")}</p> : null}
      <div className="adp-kind-groups" role="group" aria-label={t("views.byKind")}>
        {VIEW_KINDS.map((value) => (
          <Button
            key={value}
            variant={value === kind ? "primary" : "subtle"}
            aria-pressed={value === kind}
            onClick={() => setKind(value === kind ? null : value)}
          >
            <span>{t(VIEW_KIND_LABEL_KEYS[value])}</span>
            <span className="adp-view-count">{counts.get(value) ?? 0}</span>
          </Button>
        ))}
      </div>
      <ViewResultList results={page?.results ?? []} onOpenFile={onOpenFile} />
      {kind && !loading && !error && (page?.results.length ?? 0) === 0 ? (
        <p className="adp-view-empty">{t("search.empty")}</p>
      ) : null}
      {page?.next_cursor ? (
        <div className="adp-view-more">
          <Button variant="subtle" disabled={loadingMore} onClick={loadMore}>
            {t("search.loadMore")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
