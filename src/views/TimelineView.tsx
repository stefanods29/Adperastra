import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import TextInput from "../components/TextInput";
import type { SearchQuery, SearchResult } from "../services/search";
import {
  bucketLabel,
  DATE_SOURCE_LABEL_KEYS,
  dateSourceUnix,
  foldWeekBuckets,
  localMonthKey,
  parseLocalMonth,
  resolveWeekStart,
  timelineBucketId,
  undatedBucket,
  VIEW_GROUP_LABEL_KEYS,
  type DateSource,
  type IndexedViewQuery,
  type ViewGroup,
} from "../services/smartViews";
import { useIndexedViewPage, viewErrorText } from "./useIndexedViewPage";
import ViewResultList from "./ViewResultList";

const GROUPS: readonly ViewGroup[] = ["day", "week", "month", "year"];

export interface TimelineViewProps {
  query: SearchQuery;
  active: boolean;
  dateSource?: DateSource;
  weekStart?: "system" | "monday" | "sunday";
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
}

function groupResults(
  results: readonly SearchResult[],
  group: ViewGroup,
  weekStart: 0 | 1,
  source: DateSource,
): Map<string, SearchResult[]> {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const key = timelineBucketId(dateSourceUnix(result, source), group, weekStart);
    const rows = groups.get(key);
    if (rows) rows.push(result);
    else groups.set(key, [result]);
  }
  return groups;
}

export default function TimelineView({
  query,
  active,
  dateSource = "modified",
  weekStart = "system",
  onOpenFile,
  onOpenHelp,
}: TimelineViewProps) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => localMonthKey(Math.floor(Date.now() / 1000)));
  const [group, setGroup] = useState<ViewGroup>("day");
  const beginOfWeek = resolveWeekStart(weekStart);
  const request = useMemo<IndexedViewQuery>(
    () => ({
      view: "timeline",
      query,
      date_source: dateSource,
      group,
      month,
    }),
    [query, dateSource, group, month],
  );
  const { page, error, loading, loadingMore, reload, loadMore } = useIndexedViewPage(
    request,
    active,
  );

  const buckets = useMemo(() => {
    const native = page?.buckets ?? [];
    return group === "week" ? foldWeekBuckets(native, beginOfWeek) : native;
  }, [page, group, beginOfWeek]);
  const missing = undatedBucket(page?.buckets ?? []);
  const rows = useMemo(
    () => groupResults(page?.results ?? [], group, beginOfWeek, dateSource),
    [page, group, beginOfWeek, dateSource],
  );
  const ordered = useMemo(
    () =>
      [...buckets]
        .filter((bucket) => bucket.id !== "undated")
        .sort((left, right) => (right.date_from_unix ?? 0) - (left.date_from_unix ?? 0)),
    [buckets],
  );

  return (
    <section className="adp-view adp-timeline" aria-label={t("views.timeline")} aria-busy={loading}>
      <header className="adp-view-header">
        <h2 className="adp-view-title">{t("views.timeline")}</h2>
        <TextInput
          type="month"
          value={month}
          onChange={(value) => {
            // A cleared or partial month input must not turn into a query the
            // native validator rejects (`views.invalid`); keep the last month.
            if (parseLocalMonth(value)) setMonth(value);
          }}
          ariaLabel={t("views.month")}
        />
        <div className="adp-view-switch" role="group" aria-label={t("views.title")}>
          {GROUPS.map((value) => (
            <Button
              key={value}
              variant={value === group ? "primary" : "subtle"}
              aria-pressed={value === group}
              onClick={() => setGroup(value)}
            >
              {t(VIEW_GROUP_LABEL_KEYS[value])}
            </Button>
          ))}
        </div>
        <span className="adp-view-source">{t(DATE_SOURCE_LABEL_KEYS[dateSource])}</span>
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
      <div className="adp-timeline-groups">
        {ordered.map((bucket) => (
          <section key={bucket.id} className="adp-timeline-group" data-bucket-id={bucket.id}>
            <h3 className="adp-timeline-heading">
              <span>{bucketLabel(bucket, group, i18n.language)}</span>
              <span className="adp-view-count">{bucket.count}</span>
            </h3>
            <ViewResultList results={rows.get(bucket.id) ?? []} onOpenFile={onOpenFile} />
          </section>
        ))}
        {missing && missing.count > 0 ? (
          <section className="adp-timeline-group" data-bucket-id="undated">
            <h3 className="adp-timeline-heading">
              <span>{t("views.undated")}</span>
              <span className="adp-view-count">{missing.count}</span>
            </h3>
            <ViewResultList results={rows.get("undated") ?? []} onOpenFile={onOpenFile} />
          </section>
        ) : null}
      </div>
      {!loading && !error && (page?.results.length ?? 0) === 0 ? (
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
