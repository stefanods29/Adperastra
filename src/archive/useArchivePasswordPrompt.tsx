import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ArchiveAuth } from "../services/archive";
import ArchivePasswordDialog from "./ArchivePasswordDialog";

/** A stable way to ask for one archive password (Step 06e T10). Only one
 * prompt is open at a time; unmounting cancels every waiting caller. */
export type ArchivePasswordAttempt = (auth: ArchiveAuth) => Promise<void>;

export interface ArchivePasswordPrompt {
  /** Show the dialog and run `attempt` with each submitted password. Resolves
   * true when the attempt succeeded and false when the user cancelled. */
  ask: (
    name: string,
    code: string | null,
    attempt: ArchivePasswordAttempt,
  ) => Promise<boolean>;
  /** Resolve every waiting prompt with "cancelled" (tab closed, path changed). */
  cancelAll: () => void;
  /** Render this somewhere inside the view. */
  dialog: ReactNode;
}

interface PendingPrompt {
  name: string;
  code: string | null;
  attempt: ArchivePasswordAttempt;
  resolve: (done: boolean) => void;
}

export function useArchivePasswordPrompt(): ArchivePasswordPrompt {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const pendingRef = useRef<PendingPrompt | null>(null);

  const finish = useCallback((done: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(done);
  }, []);

  const ask = useCallback<ArchivePasswordPrompt["ask"]>((name, code, attempt) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { name, code, attempt, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const cancelAll = useCallback(() => finish(false), [finish]);

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const dialog = pending ? (
    <ArchivePasswordDialog
      name={pending.name}
      errorCode={pending.code}
      onSubmit={async (auth) => {
        await pending.attempt(auth);
        finish(true);
      }}
      onCancel={() => finish(false)}
    />
  ) : null;

  return { ask, cancelAll, dialog };
}
