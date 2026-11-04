import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import CreateLockedCopyDialog from "./CreateLockedCopyDialog";
import LockPendingCurtain from "./LockPendingCurtain";
import UnlockDialog from "./UnlockDialog";
import { errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import {
  chooseLockedRecovery,
  exportUnlockedCopy,
  listLockedEntries,
  listLockedRecovery,
  lockFolder,
  lockedIdleCheck,
  saveLockedCopy,
  type LockedCreateResult,
  type LockedRecoveryAction,
  type LockedRecoveryItem,
  type LockedSession,
  type LockedSettings,
} from "../services/lockedFolders";
import {
  registerLockedCloseChooser,
  registerLockedSession,
  releaseLockedSession,
  type LockedCloseChoice,
} from "../documents/LockedDocumentProvider";
import { archivePickFolder } from "../services/archive";
import { pickSavePath } from "../services/textFiles";

export interface LockedFolderHostOptions {
  onOpenHelp: (slug: string) => void;
  onOpenLockedTab?: (session: LockedSession) => void;
  onCreated?: (result: LockedCreateResult) => void;
  /** Live Settings > Locked folders. "Never" stops the idle polling; the
   * user can still lock by hand. */
  settings?: LockedSettings;
}

export interface LockedFolderHost {
  session: LockedSession | null;
  setSession: (session: LockedSession | null) => void;
  /** Release a locked/closed session without reporting a new one. */
  forgetSession: (session: LockedSession) => void;
  /** Show the pending curtain for a lock started by a locked tab. */
  showPending: (session: LockedSession, reason?: string) => void;
  openCreate: (sourceDir: string) => void;
  openUnlock: (containerPath: string) => void;
  lock: () => void;
  lockForClose: () => Promise<boolean>;
  saveCopy: () => void;
  exportCopy: (entryId?: string) => void;
  openRecovery: () => void;
  overlay: ReactNode;
}

/** Dialog and session orchestration shared by the Explorer and file tabs.
 * It keeps the wording "encrypted copy" and never claims the original is
 * protected. The actual locked tab is opened by the host callback. */
export function useLockedFolderHost(options: LockedFolderHostOptions): LockedFolderHost {
  const { t } = useTranslation();
  const [session, setSessionState] = useState<LockedSession | null>(null);
  const sessionRef = useRef<LockedSession | null>(null);
  const [createSource, setCreateSource] = useState<string | null>(null);
  const [unlockPath, setUnlockPath] = useState<string | null>(null);
  const [pending, setPending] = useState<LockedSession | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{
    items: LockedRecoveryItem[];
    loading: boolean;
    error: string | null;
    selected: string | null;
  } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [closeRequest, setCloseRequest] = useState<{
    resolve: (choice: LockedCloseChoice) => void;
  } | null>(null);

  // The 09a close policy asks this host for the one explicit decision; a
  // dirty locked document is never closed by a generic unsaved dialog.
  useEffect(() => {
    registerLockedCloseChooser(
      (_sessionId, documents) =>
        new Promise<LockedCloseChoice>((resolve) => {
          if (documents.length === 0) resolve({ choice: "keep" });
          else setCloseRequest({ resolve });
        }),
    );
    return () => registerLockedCloseChooser(null);
  }, []);

  const finishClose = useCallback((choice: LockedCloseChoice) => {
    setCloseRequest((current) => {
      current?.resolve(choice);
      return null;
    });
  }, []);

  const chooseSaveCopyForClose = useCallback(() => {
    void (async () => {
      const destination = await pickSavePath(
        t("locked.saveCopy"),
        "locked-folder.adplock",
        t("locked.containerFilter"),
      );
      if (!destination) return;
      finishClose({ choice: "save_copy", dest_path: destination });
    })();
  }, [finishClose, t]);

  const setSession = useCallback((next: LockedSession | null) => {
    const previous = sessionRef.current;
    if (next !== null && next.state === "locked") {
      // A locked session carries no usable content: release the models
      // before hiding the session.
      if (previous) releaseLockedSession(previous);
      sessionRef.current = null;
      setSessionState(null);
      setPending(null);
      setPendingError(null);
      return;
    }
    if (previous && previous.session_id !== next?.session_id) {
      releaseLockedSession(previous);
    }
    sessionRef.current = next;
    setSessionState(next);
    if (next) registerLockedSession(next);
  }, []);

  const forgetSession = useCallback((closed: LockedSession) => {
    releaseLockedSession(closed);
    if (sessionRef.current?.session_id === closed.session_id) {
      sessionRef.current = null;
      setSessionState(null);
    }
  }, []);

  const showPending = useCallback((next: LockedSession, reason?: string) => {
    sessionRef.current = next;
    setSessionState(next);
    registerLockedSession(next);
    setPending(next);
    setPendingError(reason ?? null);
  }, []);

  const openCreate = useCallback((sourceDir: string) => setCreateSource(sourceDir), []);
  const openUnlock = useCallback((containerPath: string) => setUnlockPath(containerPath), []);

  useEffect(() => {
    if (!session || options.settings?.auto_lock_minutes === 0) return;
    let disposed = false;
    let idleJob: JobHandle<LockedSession[]> | null = null;
    const timer = window.setInterval(() => {
      if (disposed || idleJob) return;
      void lockedIdleCheck()
        .then((job) => {
          if (disposed) {
            return job.cancel().then(() => null as LockedSession[] | null);
          }
          idleJob = job;
          return job.completion;
        })
        .then((states) => {
          if (disposed || !states) return;
          const current = states.find((state) => state.session_id === session.session_id);
          if (current) setSession(current);
        })
        .catch(() => undefined)
        .finally(() => {
          idleJob = null;
        });
    }, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      void idleJob?.cancel().catch(() => undefined);
    };
  }, [session, setSession, options.settings?.auto_lock_minutes]);

  const lockWithMode = useCallback(
    async (mode: "normal" | "close"): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return true;
      try {
        const job = await lockFolder({
          session_id: current.session_id,
          mode,
          discard_dirty: false,
        });
        const result = await job.completion;
        if (result.locked) {
          setSession(null);
          setPending(null);
          setPendingError(null);
          return true;
        }
        setSession(result.state);
        setPending(result.state);
        setPendingError(t("errors.locked.lock_pending"));
        return false;
      } catch (error) {
        const reason = errorText(t, error, "locked");
        setNotice(reason);
        const state = sessionRef.current ?? current;
        const failed = { ...state, state: "lock_pending" as const, dirty: true };
        setSession(failed);
        setPending(failed);
        setPendingError(reason);
        return false;
      }
    },
    [setSession, t],
  );

  const lock = useCallback(() => {
    void lockWithMode("normal");
  }, [lockWithMode]);

  const lockForClose = useCallback(() => lockWithMode("close"), [lockWithMode]);

  const saveCopy = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    void (async () => {
      const destination = await pickSavePath(
        t("locked.saveCopy"),
        "locked-folder.adplock",
        t("locked.containerFilter"),
      );
      if (!destination) return;
      try {
        const job = await saveLockedCopy({
          session_id: current.session_id,
          dest_path: destination,
          expected_revision: current.revision,
        });
        const result = await job.completion;
        setNotice(t("locked.savedCopy", { path: result.path }));
        // A copy never completes the pending lock: keep its curtain until
        // retry, verified recovery or an explicit discard.
        setPendingError(null);
        if (sessionRef.current?.state !== "lock_pending") setPending(null);
      } catch (error) {
        const reason = errorText(t, error, "locked");
        setNotice(reason);
        // A failed save copy must not drop a pending curtain or its keys.
        if (sessionRef.current?.state === "lock_pending") setPendingError(reason);
      }
    })();
  }, [t]);

  const exportCopy = useCallback(
    (entryId?: string) => {
      const current = sessionRef.current;
      if (!current) return;
      void (async () => {
        const destination = await archivePickFolder(t("locked.exportTitle"));
        if (!destination) return;
        if (!window.confirm(t("locked.copyWarning"))) return;
        try {
          const ids = entryId
            ? [entryId]
            : (await listLockedEntries(current.session_id, null)).entries.map((entry) => entry.id);
          const job = await exportUnlockedCopy(
            current.session_id,
            ids,
            destination,
            true,
          );
          await job.completion;
          setNotice(t("locked.inMemory"));
        } catch (error) {
          setNotice(errorText(t, error, "locked"));
        }
      })();
    },
    [t],
  );

  const openRecovery = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    setRecovery({ items: [], loading: true, error: null, selected: null });
    void listLockedRecovery(current.session_id)
      .then((items) => {
        setRecovery({
          items,
          loading: false,
          error: null,
          selected: items[0]?.id ?? null,
        });
      })
      .catch((error: unknown) => {
        setRecovery({
          items: [],
          loading: false,
          error: errorText(t, error, "locked"),
          selected: null,
        });
      });
  }, [t]);

  /** After unlock, offer verified encrypted changes before any entry view
   * opens; a container with no pending record stays quiet. */
  const offerRecovery = useCallback((sessionId: string) => {
    void listLockedRecovery(sessionId)
      .then((items) => {
        if (items.length > 0) {
          setRecovery({
            items,
            loading: false,
            error: null,
            selected: items[0].id,
          });
        }
      })
      .catch(() => undefined);
  }, []);

  const runRecovery = useCallback(
    (action: LockedRecoveryAction) => {
      const current = sessionRef.current;
      const selected = recovery?.selected;
      if (!current || !selected || recoveryBusy) return;
      setRecoveryBusy(true);
      void (async () => {
        try {
          const job = await chooseLockedRecovery(current.session_id, selected, action);
          const next = await job.completion;
          if (next) setSession(next);
          setRecovery(null);
        } catch (error) {
          setRecovery((previous) =>
            previous ? { ...previous, error: errorText(t, error, "locked") } : previous,
          );
        } finally {
          setRecoveryBusy(false);
        }
      })();
    },
    [recovery?.selected, recoveryBusy, setSession, t],
  );

  const overlay = (
    <>
      {createSource && (
        <CreateLockedCopyDialog
          sourceDir={createSource}
          onCreated={(result) => {
            options.onCreated?.(result);
            if (result.skipped > 0) {
              setNotice(t("locked.skippedItems", { count: result.skipped }));
            }
            setCreateSource(null);
            // Offer the normal unlock path for the new container; never
            // unlock or rebind it automatically.
            setUnlockPath(result.path);
          }}
          onClose={() => setCreateSource(null)}
          onOpenHelp={options.onOpenHelp}
        />
      )}
      {unlockPath && (
        <UnlockDialog
          path={unlockPath}
          onUnlocked={(unlocked) => {
            setSession(unlocked);
            options.onOpenLockedTab?.(unlocked);
            setUnlockPath(null);
            offerRecovery(unlocked.session_id);
          }}
          onClose={() => setUnlockPath(null)}
          onOpenHelp={options.onOpenHelp}
        />
      )}
      {pending && (
        <LockPendingCurtain
          session={pending}
          errorCode={pendingError}
          onRetry={() => {
            setPending(null);
            setPendingError(null);
            void lockWithMode("normal");
          }}
          onSaveCopy={() => {
            // Keep the curtain: a failed copy must not drop the pending keys.
            saveCopy();
          }}
          onDiscard={() => {
            const target = pending;
            setPending(null);
            setPendingError(null);
            void (async () => {
              try {
                const job = await lockFolder(
                  {
                    session_id: target.session_id,
                    mode: "normal",
                    discard_dirty: true,
                  },
                  false,
                );
                setSession((await job.completion).state);
              } catch (error) {
                setNotice(errorText(t, error, "locked"));
              }
            })();
          }}
          onOpenHelp={options.onOpenHelp}
        />
      )}
      {recovery && (
        <Dialog
          title={t("locked.recoveryAvailable")}
          onClose={() => setRecovery(null)}
          className="adp-locked-recovery-dialog"
        >
          <div className="adp-locked-form">
            {recovery.loading && <p role="status">{t("locked.unlocking")}</p>}
            {recovery.error && (
              <p className="adp-locked-error" role="alert">
                {recovery.error}
              </p>
            )}
            {!recovery.loading && recovery.items.length === 0 && (
              <p>{t("locked.recoveryLater")}</p>
            )}
            {recovery.items.length > 0 && (
              <div role="radiogroup" aria-label={t("locked.recoveryAvailable")}>
                {recovery.items.map((item) => (
                  <label key={item.id} className="adp-locked-field">
                    <input
                      type="radio"
                      name="locked-recovery"
                      checked={recovery.selected === item.id}
                      onChange={() => setRecovery({ ...recovery, selected: item.id })}
                    />
                    <span>{item.revision}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="adp-dialog-actions">
              <Button variant="subtle" onClick={() => setRecovery(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="subtle"
                disabled={!recovery.selected || recoveryBusy}
                onClick={() => runRecovery("later")}
              >
                {t("locked.recoveryLater")}
              </Button>
              <Button
                disabled={!recovery.selected || recoveryBusy}
                onClick={() => runRecovery("use_original")}
              >
                {t("locked.useOriginal")}
              </Button>
              <Button
                variant="primary"
                disabled={!recovery.selected || recoveryBusy}
                onClick={() => runRecovery("recover")}
              >
                {t("locked.recover")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {closeRequest && (
        <Dialog
          title={t("locked.closeWarning")}
          onClose={() => finishClose({ choice: "cancel" })}
          className="adp-locked-close-dialog"
        >
          <p>{t("locked.closeWarning")}</p>
          <div className="adp-dialog-actions">
            <Button variant="subtle" onClick={() => finishClose({ choice: "cancel" })}>
              {t("common.cancel")}
            </Button>
            <Button variant="subtle" onClick={() => finishClose({ choice: "discard" })}>
              {t("locked.discardChanges")}
            </Button>
            <Button onClick={() => finishClose({ choice: "keep" })}>
              {t("locked.keepRecovery")}
            </Button>
            <Button variant="primary" onClick={chooseSaveCopyForClose}>
              {t("locked.saveCopy")}
            </Button>
          </div>
        </Dialog>
      )}
      {notice && (
        <div className="adp-locked-notice" role="status">
          {notice}
        </div>
      )}
    </>
  );

  return {
    session,
    setSession,
    forgetSession,
    showPending,
    openCreate,
    openUnlock,
    lock,
    lockForClose,
    saveCopy,
    exportCopy,
    openRecovery,
    overlay,
  };
}

