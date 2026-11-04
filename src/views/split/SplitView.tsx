import { ArrowLeftRight, Columns2, Link2, Rows2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import IconButton from "../../components/IconButton";
import Tooltip from "../../components/Tooltip";
import {
  SPLIT_DIVIDER_SIZE,
  SPLIT_LEAF_MIN_HEIGHT,
  SPLIT_LEAF_MIN_WIDTH,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  clampSplitRatio,
  splitSideLabelKey,
  swapSplitState,
  withSplitActiveSide,
  withSplitDirection,
  withSplitRatio,
  withSplitSyncScroll,
  type SplitDirection,
  type SplitLeaf,
  type SplitSide,
  type SplitState,
} from "../../services/splitViews";
import SplitDivider from "./SplitDivider";
import { splitFocusRoute, type SplitHost } from "./splitHost";
import { useScrollSync } from "./useScrollSync";

/** A split tab's two sides (Step 09i T3). Presentation only: it reads the
 * `SplitState` it is given, renders each leaf through the host, and asks
 * the host for scroll ports and close decisions. It never queries another
 * component's DOM for state, and it never calls `invoke`.
 *
 * Accessibility: each side is a labelled group, the active side shows a
 * 2 px accent edge plus a textual "Active side" line, the divider is a
 * separator with its 20-80 percent range, and below the minimum size one
 * side is shown at a time with an explicit Side 1 / Side 2 switcher (the
 * hidden side is inert and hidden from assistive technology, never
 * clipped behind the visible one). */

export interface SplitViewProps {
  tab_id: string;
  state: SplitState;
  active: boolean;
  host: SplitHost;
  onChange: (state: SplitState) => void;
  onCloseSide: (side: SplitSide) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

function useCompactLayout(nodeRef: { current: HTMLDivElement | null }, direction: SplitDirection): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const extent = direction === "vertical" ? rect.width : rect.height;
      const needed =
        direction === "vertical"
          ? SPLIT_LEAF_MIN_WIDTH * 2 + SPLIT_DIVIDER_SIZE
          : SPLIT_LEAF_MIN_HEIGHT * 2 + SPLIT_DIVIDER_SIZE;
      // An unmeasured element (0 px, e.g. before layout) is not evidence
      // that the window is too small: keep both sides until a real size
      // arrives.
      setCompact(extent > 0 && extent < needed);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [nodeRef, direction]);
  return compact;
}

export default function SplitView({
  tab_id,
  state,
  active,
  host,
  onChange,
  onCloseSide,
  onOpenHelp,
}: SplitViewProps) {
  const { t } = useTranslation();
  const panesRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLDivElement | null>(null);
  const secondRef = useRef<HTMLDivElement | null>(null);
  const [previewRatio, setPreviewRatio] = useState<number | null>(null);
  const compact = useCompactLayout(panesRef, state.direction);
  // Hiding the divider cancels an unfinished drag instead of keeping a
  // preview ratio that no divider can commit.
  useEffect(() => {
    if (compact) setPreviewRatio(null);
  }, [compact]);
  const ratio = previewRatio ?? state.ratio;
  const firstActive = state.active_side === "first";
  const activeViewId = firstActive ? state.first.view_id : state.second.view_id;

  const sync = useScrollSync(state.first.view_id, state.second.view_id, {
    enabled: active && state.sync_scroll,
    activeViewId,
    resolve: (viewId) => host.getScrollPort(viewId),
  });

  const activate = (side: SplitSide) => {
    if (!active || state.active_side === side) return;
    onChange(withSplitActiveSide(state, side));
  };

  const focusSide = (side: SplitSide) => {
    activate(side);
    const node = side === "first" ? firstRef.current : secondRef.current;
    node?.focus();
  };

  const commitRatio = (value: number) => {
    setPreviewRatio(null);
    const next = clampSplitRatio(value);
    if (next === state.ratio) return;
    onChange(withSplitRatio(state, next));
  };

  const commitDirection = (direction: SplitDirection) => {
    if (state.direction === direction) return;
    onChange(withSplitDirection(state, direction));
  };

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    if (event.key !== "F6" || event.altKey || event.ctrlKey || event.metaKey) return;
    const route = splitFocusRoute(state.active_side);
    // From Side 2 the next region is the toolbar, which the application
    // router owns: leave that F6 for it instead of trapping focus here.
    if (route === "after") return;
    event.preventDefault();
    event.stopPropagation();
    focusSide(route);
  };

  const renderLeaf = (leaf: SplitLeaf, side: SplitSide): ReactNode => {
    const isActive = state.active_side === side;
    const hidden = compact && !isActive;
    const ref = side === "first" ? firstRef : secondRef;
    return (
      <div
        key={leaf.view_id}
        ref={ref}
        className={`adp-split-leaf adp-split-leaf--${side}`}
        data-side={side}
        data-active={isActive ? "true" : "false"}
        role="group"
        aria-label={t(splitSideLabelKey(side))}
        aria-hidden={hidden ? true : undefined}
        inert={hidden ? true : undefined}
        tabIndex={-1}
        onPointerDownCapture={() => activate(side)}
        onFocusCapture={() => activate(side)}
      >
        {host.renderLeaf(leaf, isActive, () => focusSide(side))}
      </div>
    );
  };

  const firstBasis = compact
    ? undefined
    : { flex: `0 0 calc(${(ratio * 100).toFixed(4)}% - ${SPLIT_DIVIDER_SIZE / 2}px)` };
  const paneClass = (side: SplitSide): string => {
    const hidden = compact && state.active_side !== side;
    return `adp-split-pane adp-split-pane--${side}${hidden ? " adp-split-pane--hidden" : ""}`;
  };

  return (
    <div
      className="adp-split-view"
      data-direction={state.direction}
      data-tab-id={tab_id}
      onKeyDown={onRootKeyDown}
    >
      <div className="adp-split-controls" role="toolbar" aria-label={t("splits.title")}>
        <span className="adp-split-active" role="status">
          {t("splits.active", { side: t(splitSideLabelKey(state.active_side)) })}
        </span>
        <IconButton icon={ArrowLeftRight} labelKey="splits.swap" onClick={() => onChange(swapSplitState(state))} />
        <IconButton
          icon={Columns2}
          labelKey="splits.vertical"
          pressed={state.direction === "vertical"}
          onClick={() => commitDirection("vertical")}
        />
        <IconButton
          icon={Rows2}
          labelKey="splits.horizontal"
          pressed={state.direction === "horizontal"}
          onClick={() => commitDirection("horizontal")}
        />
        {sync.available ? (
          <IconButton
            icon={Link2}
            labelKey="splits.sync"
            pressed={state.sync_scroll}
            onClick={() => onChange(withSplitSyncScroll(state, !state.sync_scroll))}
          />
        ) : (
          <Tooltip label={t("splits.syncUnavailable")}>
            <IconButton icon={Link2} labelKey="splits.sync" disabled />
          </Tooltip>
        )}
        <span className="adp-split-controls-spacer" />
        <IconButton icon={X} labelKey="splits.closeSide" onClick={() => void onCloseSide(state.active_side)} />
        <HelpButton onOpenHelp={() => onOpenHelp("split-view")} />
      </div>
      {compact ? (
        <div className="adp-split-switcher" role="group" aria-label={t("splits.title")}>
          <span className="adp-split-compact-note">{t("splits.compact")}</span>
          <Button
            variant={firstActive ? "primary" : "default"}
            aria-pressed={firstActive}
            onClick={() => focusSide("first")}
          >
            {t("splits.first")}
          </Button>
          <Button
            variant={firstActive ? "default" : "primary"}
            aria-pressed={!firstActive}
            onClick={() => focusSide("second")}
          >
            {t("splits.second")}
          </Button>
        </div>
      ) : null}
      {state.sync_scroll && !sync.available ? (
        <p className="adp-split-status" role="status">
          {t("splits.syncUnavailable")}
        </p>
      ) : null}
      <div
        ref={panesRef}
        className={`adp-split-panes${compact ? " adp-split-compact" : ""}`}
        data-direction={state.direction}
        data-compact={compact ? "true" : "false"}
      >
        <div className={paneClass("first")} style={firstBasis}>
          {renderLeaf(state.first, "first")}
        </div>
        {compact ? null : (
          <SplitDivider
            direction={state.direction}
            ratio={ratio}
            min={SPLIT_RATIO_MIN}
            max={SPLIT_RATIO_MAX}
            onPreview={setPreviewRatio}
            onCommit={commitRatio}
            onCancel={() => setPreviewRatio(null)}
          />
        )}
        <div className={paneClass("second")}>{renderLeaf(state.second, "second")}</div>
      </div>
    </div>
  );
}
