import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import {
  ACTIVITY_LABEL_KEYS,
  clearActivity,
  getActivityStatus,
  listActivity,
  setActivityPaused,
  type ActivityEvent,
} from "../services/smartViews";
import { viewErrorText } from "./useIndexedViewPage";

export interface RecentActivityViewProps {
  active: boolean;
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
}

/** Recent activity (Step 11b E5 and decision 8): only actions this app
 * committed, newest first, locally recorded and bounded. Clearing removes
 * this list only; no file is ever touched. */
export default function RecentActivityView({
  active,
  onOpenFile,
  onOpenHelp,
}: RecentActivityViewProps) {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    setError(null);
    void Promise.all([getActivityStatus(), listActivity(null)])
      .then(([status, page]) => {
        if (disposed) return;
        setPaused(status.paused);
        setEvents(page.events);
        setCursor(page.next_cursor ?? null);
        setComplete(page.complete);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [active, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listActivity(cursor);
      setEvents((current) => [...current, ...page.events]);
      setCursor(page.next_cursor ?? null);
      setComplete(page.complete);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  };

  const togglePaused = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await setActivityPaused(!paused);
      setPaused(status.paused);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearActivity();
      setEvents([]);
      setCursor(null);
      setComplete(true);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  return (
    <section className="adp-view adp-activity" aria-label={t("views.activity")} aria-busy={loading}>
      <header className="adp-view-header">
        <h2 className="adp-view-title">{t("views.activity")}</h2>
        <Button
          variant={paused ? "primary" : "subtle"}
          aria-pressed={paused}
          data-activity-action="pause"
          disabled={busy}
          onClick={() => void togglePaused()}
        >
          {t("views.pauseActivity")}
        </Button>
        <Button
          variant="subtle"
          data-activity-action="clear"
          disabled={busy || loading}
          onClick={() => void clear()}
        >
          {t("views.clearActivity")}
        </Button>
        <Button variant="subtle" disabled={loading} onClick={reload}>
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
      <ul className="adp-activity-list">
        {events.map((event) => {
          const target = event.dest_path ?? event.path;
          return (
            <li
              key={event.id}
              className="adp-activity-row"
              data-activity-kind={event.kind}
              data-activity-id={event.id}
            >
              <span className="adp-activity-kind">{t(ACTIVITY_LABEL_KEYS[event.kind])}</span>
              <button
                type="button"
                className="adp-activity-path"
                title={target}
                onClick={() => onOpenFile(target)}
              >
                {target}
              </button>
              {event.dest_path ? (
                <span className="adp-activity-source">{event.path}</span>
              ) : null}
              <time
                className="adp-activity-time"
                dateTime={new Date(event.created_unix * 1000).toISOString()}
              >
                {formatter.format(new Date(event.created_unix * 1000))}
              </time>
            </li>
          );
        })}
      </ul>
      {!loading && !error && events.length === 0 ? (
        <p className="adp-view-empty">{t("search.empty")}</p>
      ) : null}
      {!complete && cursor ? (
        <div className="adp-view-more">
          <Button variant="subtle" disabled={loading} onClick={() => void loadMore()}>
            {t("search.loadMore")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
