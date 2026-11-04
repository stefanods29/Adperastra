import {
  File as FileIcon,
  FileImage,
  Folder,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import ProgressBar from "../components/ProgressBar";
import Skeleton from "../components/Skeleton";
import { errorCode, errorText } from "../services/errors";
import { formatDate, formatSize } from "../services/format";
import {
  listLockedEntries,
  lockFolder,
  saveLockedCopy,
  touchLockedSession,
  type LockedEntry,
  type LockedEntryPage,
  type LockedSession,
} from "../services/lockedFolders";
import { pickSavePath } from "../services/textFiles";
import { registerLockedSession } from "../documents/LockedDocumentProvider";

export interface LockedFolderViewProps {
  session: LockedSession;
  parentId: string | null;
  active: boolean;
  onOpenEntry: (entryId: string) => Promise<void>;
  onSessionChange: (session: LockedSession) => void;
  onOpenHelp: (slug: string) => void;
  /** Additive host hooks; the core E6 contract stays as above. */
  onNavigateRoot?: () => void;
  onExportEntry?: (entryId: string) => void;
  onOpenRecovery?: () => void;
}

interface TrailItem {
  id: string;
  label: string;
}

/** Browser for one unlocked container (Step 09k E6). It shows opaque ids,
 * decrypted names in memory only, and never calls a filesystem command. */
export default function LockedFolderView({
  session,
  parentId,
  active,
  onOpenEntry,
  onSessionChange,
  onOpenHelp,
  onNavigateRoot,
  onExportEntry,
  onOpenRecovery,
}: LockedFolderViewProps) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<LockedEntryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<LockedEntry | null>(null);
  const [trail, setTrail] = useState<TrailItem[]>([{ id: "root", label: t("locked.title") }]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (session.state === "locked") return;
    registerLockedSession(session);
  }, [session]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setError(null);
    void listLockedEntries(session.session_id, parentId)
      .then((result) => {
        if (!alive) return;
        setPage(result);
        setSelected(null);
        if (parentId === null) {
          setTrail([{ id: "root", label: t("locked.title") }]);
        }
      })
      .catch((failure) => {
        if (alive) setError(errorText(t, failure, "locked"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, parentId, session.session_id, session.revision, t]);

  async function open(entry: LockedEntry): Promise<void> {
    setUnsupported(null);
    setError(null);
    try {
      if (entry.kind === "folder") {
        setTrail((current) => [...current.filter((item) => item.id !== entry.id), { id: entry.id, label: entry.name }]);
      }
      await onOpenEntry(entry.id);
    } catch (failure) {
      const code = errorCode(failure);
      if (code === "locked.unsupported") {
        setUnsupported(entry);
        return;
      }
      setError(errorText(t, failure, "locked"));
    }
  }

  function move(delta: number): void {
    const entries = page?.entries ?? [];
    if (entries.length === 0) return;
    const index = Math.max(0, entries.findIndex((entry) => entry.id === selected));
    const next = Math.max(0, Math.min(entries.length - 1, index + delta));
    setSelected(entries[next].id);
  }

  async function saveCopy(): Promise<void> {
    if (busy) return;
    const destination = await pickSavePath(
      t("locked.saveCopy"),
      "locked-folder.adplock",
      t("locked.containerFilter"),
    );
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      const job = await saveLockedCopy({
        session_id: session.session_id,
        dest_path: destination,
        expected_revision: session.revision,
      });
      const result = await job.completion;
      setNotice(t("locked.savedCopy", { path: result.path }));
      // Save copy never rebinds or cleans the original session; leave the
      // live session exactly as the native reply left it.
    } catch (failure) {
      setError(errorText(t, failure, "locked"));
    } finally {
      setBusy(false);
    }
  }

  async function lockNow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const job = await lockFolder({
        session_id: session.session_id,
        mode: "normal",
        discard_dirty: false,
      });
      const result = await job.completion;
      onSessionChange(result.state);
      if (!result.locked) setNotice(t("locked.pending"));
    } catch (failure) {
      setError(errorText(t, failure, "locked"));
      onSessionChange({ ...session, state: "lock_pending" as const, dirty: true });
    } finally {
      setBusy(false);
    }
  }

  const entries = page?.entries ?? [];
  const breadcrumb = trail;
  const nextCursor = page?.next_cursor ?? null;

  return (
    <div className="adp-locked-folder" ref={listRef}>
      <div className="adp-locked-toolbar">
        <Breadcrumb
          segments={breadcrumb}
          onNavigate={(id) => {
            if (id === "root") {
              setTrail([{ id: "root", label: t("locked.title") }]);
              onNavigateRoot?.();
            } else {
              setTrail((current) => {
                const index = current.findIndex((item) => item.id === id);
                return index >= 0 ? current.slice(0, index + 1) : current;
              });
              void onOpenEntry(id);
            }
          }}
        />
        <div className="adp-locked-toolbar-actions">
          <span className="adp-locked-status">
            <ShieldCheck size={14} aria-hidden="true" />
            {t("locked.statusUnlocked")}
          </span>
          <Button variant="subtle" onClick={() => void saveCopy()} disabled={busy}>
            <Save size={16} aria-hidden="true" />
            {t("locked.saveCopy")}
          </Button>
          <Button variant="subtle" onClick={() => void lockNow()} disabled={busy}>
            <Lock size={16} aria-hidden="true" />
            {t("locked.lock")}
          </Button>
          <HelpButton onOpenHelp={() => onOpenHelp("locked-folders")} />
        </div>
      </div>
      <div className="adp-locked-banners">
        <p className="adp-locked-note">{t("locked.inMemory")}</p>
        <p className="adp-locked-note">{t("locked.limits")}</p>
        <p className="adp-locked-note">{t("locked.unlockedWarning")}</p>
        {session.pending_recovery && onOpenRecovery && (
          <button type="button" className="adp-locked-recovery-link" onClick={onOpenRecovery}>
            <KeyRound size={14} aria-hidden="true" />
            {t("locked.recover")}
          </button>
        )}
      </div>
      {loading && <Skeleton variant="rows" count={8} />}
      {!loading && error && (
        <div className="adp-locked-error" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && entries.length === 0 && (
        <div className="adp-locked-empty">{t("locked.empty")}</div>
      )}
      {!loading && !error && entries.length > 0 && (
        <div
          className="adp-locked-rows"
          role="listbox"
          aria-label={t("locked.title")}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter" && selected) {
              event.preventDefault();
              const entry = entries.find((item) => item.id === selected);
              if (entry) void open(entry);
            }
          }}
        >
          {entries.map((entry) => {
            const Icon = entry.kind === "folder" ? Folder : entry.mime.startsWith("image/") ? FileImage : FileIcon;
            const meta =
              entry.kind === "folder"
                ? t("locked.folderMeta")
                : `${formatSize(entry.size, i18n.language)} · ${formatDate(entry.modified_unix, i18n.language)}`;
            return (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={selected === entry.id}
                className={`adp-list-row adp-locked-row${selected === entry.id ? " adp-list-row--selected" : ""}`}
                onClick={() => {
                  setSelected(entry.id);
                  void touchLockedSession(session.session_id).catch(() => undefined);
                }}
                onDoubleClick={() => void open(entry)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="adp-list-row-name">{entry.name}</span>
                <span className="adp-list-row-meta">{meta}</span>
              </button>
            );
          })}
        </div>
      )}
      {nextCursor && (
        <Button
          variant="subtle"
          onClick={() => {
            void listLockedEntries(session.session_id, parentId, nextCursor).then((next) => {
              setPage({
                ...next,
                entries: [...entries, ...next.entries],
              });
            });
          }}
        >
          {t("locked.loadMore")}
        </Button>
      )}
      {unsupported && (
        <div className="adp-locked-unsupported" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t("locked.unsupported")}</span>
          {onExportEntry && (
            <Button
              variant="subtle"
              onClick={() => {
                onExportEntry(unsupported.id);
                setUnsupported(null);
              }}
            >
              {t("locked.copyOut")}
            </Button>
          )}
        </div>
      )}
      {notice && (
        <div className="adp-locked-notice" role="status">
          {notice}
        </div>
      )}
      {busy && <ProgressBar label={t("locked.saving")} />}
    </div>
  );
}
