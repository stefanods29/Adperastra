import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SearchQuery } from "../services/search";
import {
  DEFAULT_ENABLED_VIEWS,
  INDEXED_VIEW_LABEL_KEYS,
  type DateSource,
  type EnabledViews,
  type IndexedView,
} from "../services/smartViews";
import ByKindView from "./ByKindView";
import CalendarView from "./CalendarView";
import MapView from "./MapView";
import RecentActivityView from "./RecentActivityView";
import TimelineView from "./TimelineView";

const VIEW_ORDER: readonly IndexedView[] = [
  "timeline",
  "calendar",
  "by_kind",
  "recent_activity",
  "map",
];

export interface IndexedViewsProps {
  query: SearchQuery;
  active: boolean;
  onOpenFile: (path: string) => void;
  onOpenHelp: () => void;
  initialView?: IndexedView;
  enabled?: EnabledViews;
  dateSource?: DateSource;
  weekStart?: "system" | "monday" | "sunday";
}

/** The five indexed views behind one tab strip (Step 11b E7). Every view
 * renders real search results and opens files through the normal path. */
export default function IndexedViews({
  query,
  active,
  onOpenFile,
  onOpenHelp,
  initialView = "timeline",
  enabled = DEFAULT_ENABLED_VIEWS,
  dateSource = "modified",
  weekStart = "system",
}: IndexedViewsProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<IndexedView>(initialView);
  const available = VIEW_ORDER.filter((view) => enabled[view]);
  const current: IndexedView | null = available.includes(selected)
    ? selected
    : (available[0] ?? null);

  return (
    <section className="adp-indexed-views" aria-label={t("views.title")}>
      <div className="adp-view-tabs" role="group" aria-label={t("views.title")}>
        {available.map((view) => (
          <button
            key={view}
            type="button"
            className="adp-view-tab"
            data-view-tab={view}
            aria-pressed={view === current}
            onClick={() => setSelected(view)}
          >
            {t(INDEXED_VIEW_LABEL_KEYS[view])}
          </button>
        ))}
      </div>
      {current === "timeline" ? (
        <TimelineView
          query={query}
          active={active}
          onOpenFile={onOpenFile}
          onOpenHelp={onOpenHelp}
          dateSource={dateSource}
          weekStart={weekStart}
        />
      ) : null}
      {current === "calendar" ? (
        <CalendarView
          query={query}
          active={active}
          onOpenFile={onOpenFile}
          onOpenHelp={onOpenHelp}
          dateSource={dateSource}
          weekStart={weekStart}
        />
      ) : null}
      {current === "by_kind" ? (
        <ByKindView
          query={query}
          active={active}
          onOpenFile={onOpenFile}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {current === "recent_activity" ? (
        <RecentActivityView active={active} onOpenFile={onOpenFile} onOpenHelp={onOpenHelp} />
      ) : null}
      {current === "map" ? (
        <MapView query={query} active={active} onOpenFile={onOpenFile} onOpenHelp={onOpenHelp} />
      ) : null}
    </section>
  );
}
