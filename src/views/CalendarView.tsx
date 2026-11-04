import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import TextInput from "../components/TextInput";
import type { JobHandle } from "../services/jobs";
import { errorText } from "../services/errors";
import { search, type SearchPage, type SearchQuery } from "../services/search";
import {
  addFilter,
  calendarGrid,
  DATE_SOURCE_LABEL_KEYS,
  dayBounds,
  localMonthKey,
  parseLocalMonth,
  resolveWeekStart,
  weekdayLabels,
  type DateSource,
  type IndexedViewQuery,
} from "../services/smartViews";
import { useIndexedViewPage, viewErrorText } from "./useIndexedViewPage";
import ViewResultList from "./ViewResultList";

export interface CalendarViewProps {
  query: SearchQuery;
  active: boolean;
  dateSource?: DateSource;
  weekStart?: "system" | "monday" | "sunday";
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
}

export default function CalendarView({
  query,
  active,
  dateSource = "modified",
  weekStart = "system",
  onOpenFile,
  onOpenHelp,
}: CalendarViewProps) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => localMonthKey(Math.floor(Date.now() / 1000)));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayPage, setDayPage] = useState<SearchPage | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const beginOfWeek = resolveWeekStart(weekStart);
  const request = useMemo<IndexedViewQuery>(
    () => ({ view: "calendar", query, date_source: dateSource, month }),
    [query, dateSource, month],
  );
  const { page, error, loading, reload } = useIndexedViewPage(request, active);

  useEffect(() => {
    // A day outside the newly chosen month must not keep an old filter open.
    setSelectedDay(null);
    setDayPage(null);
    setDayError(null);
  }, [month]);

  const queryRef = useRef(query);
  queryRef.current = query;
  const queryKey = JSON.stringify(query);
  const ticket = useRef(0);
  useEffect(() => {
    if (!active || !selectedDay) {
      setDayPage(null);
      return;
    }
    const bounds = dayBounds(selectedDay);
    if (!bounds) return;
    const current = ++ticket.current;
    let disposed = false;
    let handle: JobHandle<SearchPage> | null = null;
    setDayLoading(true);
    setDayError(null);
    setDayPage(null);
    const dayQuery: SearchQuery = {
      ...queryRef.current,
      filter: addFilter(queryRef.current.filter, {
        kind: "date",
        field: dateSource,
        from_unix: bounds.from_unix,
        to_unix: bounds.to_unix,
      }),
    };
    search(dayQuery)
      .then((started) => {
        handle = started;
        if (disposed) {
          void started.cancel();
          return;
        }
        return started.completion.then((result) => {
          if (!disposed && current === ticket.current) setDayPage(result);
        });
      })
      .catch((caught: unknown) => {
        if (!disposed && current === ticket.current) {
          setDayError(typeof caught === "string" ? caught : "search.unavailable");
        }
      })
      .finally(() => {
        if (!disposed && current === ticket.current) setDayLoading(false);
      });
    return () => {
      disposed = true;
      void handle?.cancel();
    };
  }, [selectedDay, queryKey, dateSource, active]);

  const cells = useMemo(() => calendarGrid(month, beginOfWeek), [month, beginOfWeek]);
  const labels = useMemo(
    () => weekdayLabels(i18n.language, beginOfWeek),
    [i18n.language, beginOfWeek],
  );
  const counts = useMemo(
    () => new Map((page?.buckets ?? []).map((bucket) => [bucket.id, bucket.count])),
    [page],
  );
  const weeks = useMemo(() => {
    const result: ReturnType<typeof calendarGrid>[] = [];
    for (let index = 0; index < cells.length; index += 7) {
      result.push(cells.slice(index, index + 7));
    }
    return result;
  }, [cells]);

  return (
    <section className="adp-view adp-calendar" aria-label={t("views.calendar")} aria-busy={loading}>
      <header className="adp-view-header">
        <h2 className="adp-view-title">{t("views.calendar")}</h2>
        <TextInput
          type="month"
          value={month}
          onChange={(value) => {
            // An empty month input must not send `views.invalid` to native;
            // keep the calendar on its last valid month.
            if (parseLocalMonth(value)) setMonth(value);
          }}
          ariaLabel={t("views.month")}
        />
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
      <table className="adp-calendar-grid" role="grid" aria-label={t("views.calendar")}>
        <thead>
          <tr>
            {labels.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]?.key ?? "week"}>
              {week.map((cell) => {
                const count = counts.get(cell.key) ?? 0;
                return (
                  <td key={cell.key}>
                    <button
                      type="button"
                      className="adp-calendar-day"
                      data-date={cell.key}
                      disabled={!cell.in_month}
                      aria-pressed={selectedDay === cell.key}
                      onClick={() => setSelectedDay(cell.key)}
                    >
                      <span className="adp-calendar-number">{cell.day}</span>
                      {count > 0 ? <span className="adp-view-count">{count}</span> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {selectedDay ? (
        <section className="adp-calendar-results" aria-label={selectedDay}>
          <h3 className="adp-timeline-heading">{selectedDay}</h3>
          {dayError ? (
            <p className="adp-view-error" role="alert">
              {errorText(t, dayError, "search")}
            </p>
          ) : null}
          {dayLoading ? <p className="adp-view-loading">{t("search.loading")}</p> : null}
          <ViewResultList results={dayPage?.results ?? []} onOpenFile={onOpenFile} />
          {!dayLoading && !dayError && (dayPage?.results.length ?? 0) === 0 ? (
            <p className="adp-view-empty">{t("search.empty")}</p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
