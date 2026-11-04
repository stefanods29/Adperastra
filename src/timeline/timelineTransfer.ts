/**
 * Content-transfer and drag routing for the timeline (Step 19a T5, U4).
 *
 * Only authorized disk files that already exist as project sources can become
 * clips. A shelf item or transfer envelope carries a `DocumentRef`, never a
 * guaranteed path; a virtual/sensitive reference is refused before any
 * plaintext staging. The source stamp is checked again immediately before the
 * import. One completed drag gesture produces exactly one operation.
 */

import type { MediaSource } from "../media-edit/types";
import type { DocumentRef } from "../documents/types";
import type { SourceStamp } from "../services/cache";
import type { ShelfCatalog, ShelfItem } from "../services/shelf";
import type {
  TransferAction,
  TransferEnvelope,
  TransferReceipt,
  TransferTarget,
} from "../transfer/types";
import type { TimelineClip, TimelineOperation, TimelineProject, Track } from "./types";
import { TimelineError, newUuid } from "./types";
import { clipDurationUs } from "./timing";
import { samePath } from "../services/explorer";

export interface TimelineDropHost {
  /** The project source for an already-authorized disk reference, or null. */
  resolveSource(ref: DocumentRef): MediaSource | null;
  /** Re-capture the source stamp natively immediately before import. */
  currentStamp(path: string): Promise<SourceStamp>;
}

export interface TimelineDropContext {
  project: Readonly<TimelineProject>;
  track_id: string;
  start_us: number;
  host: TimelineDropHost;
}

function track(project: Readonly<TimelineProject>, trackId: string): Track {
  const found = project.tracks.find((item) => item.id === trackId);
  if (!found) throw new TimelineError("timeline.bad_request", "drop track");
  if (found.locked) throw new TimelineError("timeline.locked");
  return found;
}

function sameStamp(left: SourceStamp, right: SourceStamp): boolean {
  return (
    left.path_key === right.path_key &&
    left.volume_id === right.volume_id &&
    left.file_id === right.file_id &&
    left.modified_ticks === right.modified_ticks &&
    left.size_bytes === right.size_bytes
  );
}

/** Disk references from a transfer payload; virtual/sensitive ones are refused. */
export function diskRefsFromPayload(envelope: TransferEnvelope): DocumentRef[] {
  if (!envelope || envelope.payload.kind !== "files") {
    throw new TimelineError("timeline.unsupported");
  }
  if (envelope.sensitive) throw new TimelineError("timeline.unsupported", "sensitive transfer");
  const refs = envelope.payload.sources;
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > 1_000) {
    throw new TimelineError("timeline.bad_request");
  }
  for (const ref of refs) {
    if (ref.kind !== "disk") throw new TimelineError("timeline.unsupported", "virtual source");
  }
  return refs;
}

/** Available disk items on the shelf, in shelf order. */
export function shelfDiskItems(catalog: ShelfCatalog): ShelfItem[] {
  if (!catalog || !Array.isArray(catalog.items)) throw new TimelineError("timeline.bad_request");
  return catalog.items.filter((item) => item.state === "available" && item.source.kind === "disk");
}

async function clipForSource(
  source: MediaSource,
  ref: DocumentRef,
  trackValue: Track,
  startUs: number,
  host: TimelineDropHost,
): Promise<TimelineClip> {
  if (ref.kind !== "disk" || !samePath(ref.path, source.path)) {
    throw new TimelineError("timeline.unsupported", "unauthorized source");
  }
  if (source.sensitive) throw new TimelineError("timeline.unsupported");
  if (trackValue.kind === "video" && source.video_rate === null) {
    throw new TimelineError("timeline.unsupported", "no video stream");
  }
  if (trackValue.kind === "audio" && source.audio_rate === null) {
    throw new TimelineError("timeline.unsupported", "no audio stream");
  }
  const current = await host.currentStamp(source.path);
  if (!sameStamp(source.stamp, current)) throw new TimelineError("timeline.changed");
  const clip: TimelineClip = {
    id: newUuid(),
    source_id: source.id,
    link_id: null,
    start_us: startUs,
    source_in_us: 0,
    source_out_us: source.duration_us,
    speed: { num: 1, den: 1 },
    gain: 1,
    mute: false,
    solo: false,
    fade_in_us: 0,
    fade_out_us: 0,
    transform: { crop: null, rotation: 0 },
    effects: [],
  };
  return clip;
}

/**
 * Turn one `add_clips` transfer into clips placed one after another from the
 * playhead. Every reference must resolve to an existing authorized project
 * source and its stamp must still match.
 */
export async function clipsFromTransfer(
  envelope: TransferEnvelope,
  actionId: string,
  context: TimelineDropContext,
): Promise<TimelineClip[]> {
  if (actionId !== "add_clips") throw new TimelineError("timeline.unsupported");
  const target = track(context.project, context.track_id);
  if (!Number.isSafeInteger(context.start_us) || context.start_us < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  const refs = diskRefsFromPayload(envelope);
  const clips: TimelineClip[] = [];
  let start = context.start_us;
  for (const ref of refs) {
    if (ref.kind !== "disk") throw new TimelineError("timeline.unsupported");
    const source = context.host.resolveSource(ref);
    if (!source) throw new TimelineError("timeline.missing_source");
    if (!context.project.sources.some((item) => item.id === source.id)) {
      throw new TimelineError("timeline.missing_source");
    }
    const clip = await clipForSource(source, ref, target, start, context.host);
    clips.push(clip);
    start += clipDurationUs(clip);
  }
  return clips;
}

/** One drag of one clip: preview changes nothing, finish returns one move. */
export class TimelineGesture {
  private clipId: string | null = null;
  private targetTrackId: string | null = null;
  private originUs = 0;
  private candidateUs: number | null = null;
  private cancelled = false;

  begin(clipId: string, trackId: string, originUs: number): void {
    if (!clipId || !trackId) throw new TimelineError("timeline.bad_request");
    if (!Number.isSafeInteger(originUs) || originUs < 0) {
      throw new TimelineError("timeline.bad_request");
    }
    this.clipId = clipId;
    this.targetTrackId = trackId;
    this.originUs = originUs;
    this.candidateUs = null;
    this.cancelled = false;
  }

  /** Update only the drag preview; the project is not touched. */
  preview(startUs: number): void {
    if (this.clipId === null || this.cancelled) return;
    if (!Number.isSafeInteger(startUs) || startUs < 0) {
      throw new TimelineError("timeline.bad_request");
    }
    this.candidateUs = startUs;
  }

  cancel(): void {
    this.cancelled = true;
    this.candidateUs = null;
    this.clipId = null;
    this.targetTrackId = null;
  }

  get active(): boolean {
    return this.clipId !== null && !this.cancelled;
  }

  /** The single operation of this gesture, or null when nothing moved. */
  finish(): TimelineOperation | null {
    if (this.clipId === null || this.targetTrackId === null || this.cancelled) {
      this.cancel();
      return null;
    }
    const clipId = this.clipId;
    const trackId = this.targetTrackId;
    const start = this.candidateUs;
    this.clipId = null;
    this.targetTrackId = null;
    this.candidateUs = null;
    if (start === null || start === this.originUs) return null;
    return { kind: "move_clip", id: clipId, track_id: trackId, start_us: start };
  }
}

/** Apply the one operation of a finished gesture; returns whether it applied. */
export async function finishGesture(
  gesture: TimelineGesture,
  apply: (operation: TimelineOperation) => Promise<void>,
): Promise<boolean> {
  const operation = gesture.finish();
  if (!operation) return false;
  await apply(operation);
  return true;
}

export interface TimelineTransferTargetOptions {
  target_id: string;
  document_id: string;
  project: Readonly<TimelineProject>;
  track_id: string;
  start_us: number;
  host: TimelineDropHost;
  /** One accepted drop is one atomic edit/history transaction. */
  insert: (clips: readonly TimelineClip[]) => Promise<void>;
}

/**
 * The 09c `TransferTarget` a timeline registers. It advertises `add_clips`
 * only when every file reference is an authorized disk source of this
 * project; virtual/sensitive content gets no action. `accept` validates the
 * source stamp again and commits one insertion.
 */
export function createTimelineTransferTarget(
  options: TimelineTransferTargetOptions,
): TransferTarget {
  const action: TransferAction = {
    id: "add_clips",
    label_key: "transfer.clips",
    losses: [],
    mutates: true,
  };
  return {
    target_id: options.target_id,
    document_id: options.document_id,
    accepted_kinds: ["files"],
    describe(envelope: TransferEnvelope): readonly TransferAction[] {
      try {
        const refs = diskRefsFromPayload(envelope);
        if (refs.some((ref) => options.host.resolveSource(ref) === null)) return [];
        return [action];
      } catch {
        return [];
      }
    },
    async accept(envelope: TransferEnvelope, actionId: string): Promise<TransferReceipt> {
      const clips = await clipsFromTransfer(envelope, actionId, {
        project: options.project,
        track_id: options.track_id,
        start_us: options.start_us,
        host: options.host,
      });
      await options.insert(clips);
      return {
        transaction_id: newUuid(),
        target_document_id: options.document_id,
        inserted_count: clips.length,
        losses: [],
        complete: true,
      };
    },
  };
}
