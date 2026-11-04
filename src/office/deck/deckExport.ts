import type { PageRange } from "../../convert/types";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import { releaseExportSnapshot } from "../../services/exportSnapshots";
import type { OfficeController } from "../OfficeController";

/** Capturing and exporting the current deck revision (Step 22a T8).
 *
 * Capture freezes the revision/content identity before encoding, so an
 * export can never silently pick up a later edit. Publication is not done
 * here: the host supplies a 08a/09f-backed publisher, which returns the
 * actual output path or fails without touching a foreign file. */

export interface DeckExportArtifact {
  snapshot_id: string;
  mime: string;
  byte_len: number;
  slide_index: number | null;
  /** Actual path reported by the publisher; never an invented path. */
  path: string;
}

export interface DeckExportPublisher {
  /** Only a publisher that proves an encrypted/memory-safe path may accept
   * a sensitive capture. */
  accepts_sensitive: boolean;
  publish(snapshot: ExportSnapshot, suggestedName: string): Promise<string>;
}

let registeredPublisher: DeckExportPublisher | null = null;

/** The coordinator registers the one 08a/09f-backed publisher. Without it
 * export stays unavailable rather than inventing an output path. */
export function setDeckExportPublisher(publisher: DeckExportPublisher | null): void {
  registeredPublisher = publisher;
}

export function deckExportPublisher(): DeckExportPublisher | null {
  return registeredPublisher;
}

export interface DeckExportFailure {
  slide_index: number | null;
  error_code: string;
}

export interface DeckExportResult {
  artifacts: DeckExportArtifact[];
  failures: DeckExportFailure[];
  cancelled: boolean;
}

export const MAX_EXPORTED_SLIDES = 100;

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 128);
}

/** Capture the exact current revision/content identity, or fail closed. */
export async function captureCurrentDeck(controller: OfficeController): Promise<ExportSnapshot> {
  const state = controller.getState();
  if (!state.ready || state.busy) throw new Error("office_edit.busy");
  const snapshot = await controller.capture(state.revision, state.content_id);
  if (snapshot.document_id !== state.document_id ||
      snapshot.revision !== state.revision ||
      snapshot.content_id !== state.content_id) {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw new Error("office_edit.changed");
  }
  if (controller.document.info.sensitive && snapshot.storage_policy !== "sensitive") {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw new Error("office_edit.sensitive_unsupported");
  }
  return snapshot;
}

function validateRanges(ranges: readonly PageRange[]): PageRange[] {
  if (ranges.length === 0) throw new Error("office_edit.invalid");
  const sorted = [...ranges].sort((a, b) => a.first - b.first);
  let previous = 0;
  let total = 0;
  for (const range of sorted) {
    if (!Number.isInteger(range.first) || !Number.isInteger(range.last) ||
        range.first < 1 || range.last < range.first || range.first <= previous) {
      throw new Error("office_edit.invalid");
    }
    previous = range.last;
    total += range.last - range.first + 1;
  }
  if (total > MAX_EXPORTED_SLIDES) throw new Error("office_edit.too_large");
  return sorted;
}

async function publishVerified(
  snapshot: ExportSnapshot,
  expectedMime: string,
  slideIndex: number | null,
  publisher: DeckExportPublisher,
  name: string,
): Promise<DeckExportArtifact> {
  if (snapshot.mime !== expectedMime || !Number.isSafeInteger(snapshot.byte_len) || snapshot.byte_len <= 0) {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw new Error("office_edit.invalid");
  }
  if (snapshot.storage_policy === "sensitive" && !publisher.accepts_sensitive) {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw new Error("office_edit.sensitive_unsupported");
  }
  const path = await publisher.publish(snapshot, name);
  if (!path || path.length === 0) {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw new Error("office_edit.failed");
  }
  return {
    snapshot_id: snapshot.snapshot_id,
    mime: snapshot.mime,
    byte_len: snapshot.byte_len,
    slide_index: slideIndex,
    path,
  };
}

/** Export the captured current revision to PDF. */
export async function exportDeckPdf(
  controller: OfficeController,
  publisher: DeckExportPublisher,
  ranges: readonly PageRange[],
  isCancelled?: () => boolean,
): Promise<DeckExportResult> {
  const checked = validateRanges(ranges);
  const state = controller.getState();
  try {
    const lease = await controller.export(state.revision, "pdf", checked);
    const snapshot = lease.snapshot;
    if (isCancelled?.()) {
      await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
      return { artifacts: [], failures: [], cancelled: true };
    }
    const artifact = await publishVerified(snapshot, "application/pdf", null, publisher, "deck.pdf");
    return { artifacts: [artifact], failures: [], cancelled: false };
  } catch (error) {
    return { artifacts: [], failures: [{ slide_index: null, error_code: codeOf(error) }], cancelled: false };
  }
}

/** Export each selected slide as its own bounded PNG snapshot. A failed or
 * cancelled slide never invents a path; completed outputs stay reported. */
export async function exportDeckSlideImages(
  controller: OfficeController,
  publisher: DeckExportPublisher,
  slideIndexes: readonly number[],
  isCancelled?: () => boolean,
): Promise<DeckExportResult> {
  const indexes = [...new Set(slideIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_EXPORTED_SLIDES);
  if (indexes.length === 0) throw new Error("office_edit.invalid");
  const artifacts: DeckExportArtifact[] = [];
  const failures: DeckExportFailure[] = [];
  for (const index of indexes) {
    if (isCancelled?.()) return { artifacts, failures, cancelled: true };
    const state = controller.getState();
    try {
      const lease = await controller.export(state.revision, "png", [{ first: index + 1, last: index + 1 }]);
      const snapshot = lease.snapshot;
      const artifact = await publishVerified(snapshot, "image/png", index, publisher, `slide-${index + 1}.png`);
      artifacts.push(artifact);
    } catch (error) {
      failures.push({ slide_index: index, error_code: codeOf(error) });
    }
  }
  return { artifacts, failures, cancelled: false };
}
