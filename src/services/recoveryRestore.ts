import {
  discardRecovery,
  legacyRecoveryCount,
  listRecovery,
  openRecoveredCopy,
  type RecoveryListPage,
  type RecoveryOpenResult,
} from "./recovery";

/**
 * Startup recovery flow (Step 09h T3). A recovery dialog appears before the
 * restored session opens its originals, and every action is explicit:
 * opening writes a new app-owned copy, discarding removes only the recovery
 * record, and keeping leaves it for the next start.
 */

export interface StartupRecovery {
  page: RecoveryListPage;
  legacyDrafts: number;
}

export async function loadRecoveryAtStartup(): Promise<StartupRecovery> {
  const [page, legacyDrafts] = await Promise.all([
    listRecovery(),
    // The old plaintext drafts are an optional extra: a failed count must
    // never hide the encrypted records the dialog exists for.
    legacyRecoveryCount().catch(() => 0),
  ]);
  return { page, legacyDrafts };
}

/** Show the dialog only when there is an unclean exit or something to keep. */
export function shouldShowRecovery(page: RecoveryListPage): boolean {
  return page.unclean_exit || page.items.length > 0 || page.safe_mode;
}

/** Opening retains the encrypted record; only a later Discard removes it. */
export async function openReviewedRecovery(id: string): Promise<RecoveryOpenResult> {
  const handle = await openRecoveredCopy(id);
  return handle.completion;
}

export async function discardReviewedRecovery(ids: readonly string[]): Promise<void> {
  await discardRecovery(ids);
}
