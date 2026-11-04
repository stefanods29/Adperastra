import { Files, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import { errorText } from "../services/errors";
import { formatSize } from "../services/format";
import type {
  DuplicateGroup,
  DuplicateMember,
  DuplicatePage,
  DuplicateRequest,
} from "../services/storage";
import {
  duplicatePage,
  executeDuplicateCleanup,
  findDuplicates,
  prepareDuplicateCleanup,
  releaseDuplicateScan,
} from "../services/storage";
import DuplicateReviewDialog, {
  cleanupCanRun,
  defaultKeepers,
  keeperSelectionIsValid,
  memberKey,
  selectedCopies,
  suggestKeeper,
} from "./DuplicateReviewDialog";

export interface DuplicateFinderProps {
  request: DuplicateRequest;
  active: boolean;
  onOpenFile: (path: string) => Promise<void>;
  onOpenHelp: (slug: string) => void;
  /** Set by the Explorer host so the view can return to the folder list. */
  onClose?: () => void;
}

/** Duplicate review view (Step 11c T5/E6). Every copy starts kept; cleanup
 * is an explicit review and stays unavailable until an exact approved-object
 * recycle operation is proved. There is no automatic deletion and no
 * permanent-delete fallback. */
export default function DuplicateFinder(props: DuplicateFinderProps) {
  const { t, i18n } = useTranslation();
  const [scanId, setScanId] = useState<string | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [cleanupAvailable, setCleanupAvailable] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [coverage, setCoverage] = useState<"complete" | "partial">("complete");
  const [keepers, setKeepers] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepNotice, setKeepNotice] = useState(false);
  const requestKey = [
    props.request.roots.join("\n"),
    props.request.include_hidden ? "1" : "0",
    props.request.allow_network ? "1" : "0",
    props.request.minimum_bytes,
  ].join("|");
  const scanIdRef = useRef<string | null>(null);
  const jobRef = useRef<{ cancel: () => Promise<void> } | null>(null);

  const mergePage = useCallback((page: DuplicatePage, append: boolean) => {
    setGroups((current) => (append ? [...current, ...page.groups] : page.groups));
    setScanId(page.scan_id);
    scanIdRef.current = page.scan_id;
    setCursor(page.next_cursor ?? null);
    setComplete(page.complete);
    setCleanupAvailable(page.cleanup_available);
    setSkipped(page.skipped_count);
    setCoverage(page.coverage);
    setKeepers((current) => {
      const next: Record<string, Set<string>> = append ? { ...current } : {};
      for (const group of page.groups) {
        if (!next[group.id]) next[group.id] = defaultKeepers(group);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!props.active) return;
    let cancelled = false;
    let job: { cancel: () => Promise<void> } | null = null;
    setLoading(true);
    setError(null);
    setGroups([]);
    setKeepers({});
    void (async () => {
      try {
        const handle = await findDuplicates(props.request);
        job = handle;
        jobRef.current = handle;
        const page = await handle.completion;
        if (!cancelled) {
          mergePage(page, false);
          setLoading(false);
        }
      } catch (failure) {
        if (!cancelled) {
          setError(failure);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (job) void job.cancel();
      jobRef.current = null;
      const finished = scanIdRef.current;
      scanIdRef.current = null;
      if (finished) void releaseDuplicateScan(finished).catch(() => undefined);
    };
  }, [props.active, requestKey, mergePage]);

  const restart = async () => {
    setLoading(true);
    setError(null);
    try {
      const handle = await findDuplicates(props.request);
      jobRef.current = handle;
      const page = await handle.completion;
      const previous = scanIdRef.current;
      mergePage(page, false);
      if (previous && previous !== page.scan_id) {
        void releaseDuplicateScan(previous).catch(() => undefined);
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!scanId || !cursor) return;
    setLoading(true);
    try {
      const page = await duplicatePage(scanId, cursor);
      mergePage(page, true);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  };

  const group = groups.find((item) => item.id === reviewId) ?? null;
  const groupKeepers = group ? keepers[group.id] ?? defaultKeepers(group) : new Set<string>();

  const toggleKeep = (member: DuplicateMember) => {
    if (!group) return;
    const key = memberKey(member);
    const current = new Set(groupKeepers);
    setKeepNotice(false);
    if (current.has(key)) {
      if (current.size <= 1) {
        setKeepNotice(true);
        return;
      }
      current.delete(key);
    } else {
      current.add(key);
    }
    setKeepers((all) => ({ ...all, [group.id]: current }));
  };

  const suggest = () => {
    if (!group) return;
    const keeper = suggestKeeper(group, props.request.roots);
    if (!keeper) return;
    setKeepers((all) => ({ ...all, [group.id]: new Set([keeper]) }));
  };

  const confirm = async () => {
    if (!group || !scanId) return;
    if (!cleanupCanRun(group, groupKeepers, cleanupAvailable)) return;
    const selected = selectedCopies(group, groupKeepers).map((member) => member.key);
    const kept = group.members
      .filter((member) => groupKeepers.has(memberKey(member)))
      .map((member) => member.key);
    setBusy(true);
    setError(null);
    try {
      const plan = await prepareDuplicateCleanup(scanId, selected, kept);
      const job = await executeDuplicateCleanup(plan.plan_id);
      await job.completion;
      setReviewId(null);
    } catch (failure) {
      // A failed cleanup leaves the review open and the history cursor
      // untouched; nothing is pushed to Undo here.
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const groupTitle = (item: DuplicateGroup) =>
    t("duplicates.title") + ` - ${item.member_count}`;

  return (
    <div className="adp-duplicates">
      <header className="adp-storage-header">
        <div className="adp-storage-title">
          <Files size={18} aria-hidden="true" />
          <div>
            <h1>{t("duplicates.title")}</h1>
            <span className="adp-storage-root">
              {props.request.roots.join(", ")}
            </span>
          </div>
        </div>
        <div className="adp-storage-header-actions">
          {loading ? (
            <Button
              variant="subtle"
              onClick={() => void jobRef.current?.cancel()}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button variant="subtle" onClick={() => void restart()} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("duplicates.find")}
          </Button>
          <HelpButton onOpenHelp={() => props.onOpenHelp("finding-duplicates")} />
          {props.onClose ? (
            <button
              type="button"
              className="adp-icon-btn"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={props.onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="adp-duplicate-warning" role="alert">
          {errorText(t, error, "duplicates")}
        </p>
      ) : null}
      {!cleanupAvailable ? (
        <p className="adp-duplicate-warning">{t("duplicates.cleanupUnavailable")}</p>
      ) : null}
      {coverage === "partial" || skipped > 0 ? (
        <p className="adp-storage-note">{t("storage.partial")}</p>
      ) : null}

      {loading && groups.length === 0 ? (
        <div role="status" aria-label={t("duplicates.scanning")}>
          <p>{t("duplicates.scanning")}</p>
          <Skeleton variant="rows" count={5} />
        </div>
      ) : null}

      {!loading && complete && groups.length === 0 ? (
        <p className="adp-storage-empty">{t("duplicates.none")}</p>
      ) : null}

      <ul className="adp-duplicate-groups" aria-label={t("duplicates.title")}>
        {groups.map((item) => {
          const kept = keepers[item.id] ?? defaultKeepers(item);
          const selected = selectedCopies(item, kept);
          const invalid = !keeperSelectionIsValid(item, kept);
          return (
            <li key={item.id} className="adp-duplicate-group">
              <div className="adp-duplicate-group-header">
                <span>{groupTitle(item)}</span>
                <span
                  className={
                    item.verified
                      ? "adp-duplicate-badge"
                      : "adp-duplicate-badge adp-duplicate-badge--warning"
                  }
                >
                  {item.verified ? t("duplicates.verified") : t("duplicates.unverified")}
                </span>
                <span>
                  {t("duplicates.reclaim", {
                    size:
                      typeof item.reclaimable_bytes === "number"
                        ? formatSize(item.reclaimable_bytes, i18n.language)
                        : t("storage.unknownValue"),
                  })}
                </span>
                <Button
                  variant="subtle"
                  disabled={!item.members_page_complete || !item.verified}
                  onClick={() => setReviewId(item.id)}
                >
                  {t("duplicates.review")}
                </Button>
              </div>
              <ul className="adp-duplicate-member-preview">
                {item.members.slice(0, 8).map((member) => (
                  <li key={memberKey(member)}>
                    <button
                      type="button"
                      className="adp-duplicate-open"
                      onClick={() => void props.onOpenFile(member.paths[0])}
                    >
                      <span title={member.paths[0]}>{member.paths[0]}</span>
                      <span>{formatSize(member.logical_bytes, i18n.language)}</span>
                    </button>
                    {member.paths.length > 1 ? (
                      <span className="adp-duplicate-hardlink">{t("duplicates.hardlink")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {!item.members_page_complete ? (
                <p className="adp-duplicate-warning">{t("duplicates.incompleteGroup")}</p>
              ) : null}
              {invalid || (reviewId === item.id && keepNotice) ? (
                <p className="adp-duplicate-warning">{t("duplicates.keepOne")}</p>
              ) : null}
              {selected.length > 0 ? (
                <p className="adp-duplicate-summary">
                  {t("duplicates.reclaim", {
                    size:
                      typeof item.reclaimable_bytes === "number"
                        ? formatSize(item.reclaimable_bytes, i18n.language)
                        : t("storage.unknownValue"),
                  })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {cursor ? (
        <Button variant="subtle" onClick={() => void loadMore()} disabled={loading}>
          {t("storage.loadMore")}
        </Button>
      ) : null}

      {group ? (
        <DuplicateReviewDialog
          group={group}
          keepers={groupKeepers}
          capability={cleanupAvailable}
          busy={busy}
          error={error ? errorText(t, error, "duplicates") : null}
          onToggleKeep={toggleKeep}
          onSuggest={suggest}
          onConfirm={() => void confirm()}
          onClose={() => setReviewId(null)}
        />
      ) : null}
    </div>
  );
}

