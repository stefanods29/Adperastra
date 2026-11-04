import { handlers } from "../handlers";
import { previewGrant, previewRevoke } from "../services/previewAccess";
import type { HandlerRegistry } from "../handlers/registry";
import type { FileTabStatus, Handler, HandlerViewProps } from "../handlers/types";
import { fileUrl, type FileTypeInfo } from "../services/files";

/** Read-only previews through the existing handler registry (Step 07b T4).
 *
 * A preview never becomes an editor: the handler receives `previewOnly`
 * true and none of the mutation callbacks (`registerSave`, `onDirtyChange`,
 * `onPathChange`), and its bytes arrive through one per-file grant that is
 * revoked on every path change and on close. */

export type PreviewTarget =
  | { kind: "preview"; handler: Handler }
  | { kind: "cloud" }
  | { kind: "unsupported" };

/** What the preview can show for one detected file. An online-only file is
 * shown as a cloud state before any handler or grant is used (D2/D8). */
export function previewTargetFor(
  info: FileTypeInfo,
  registry: HandlerRegistry = handlers,
): PreviewTarget {
  if (info.online_only) return { kind: "cloud" };
  const handler = registry.pick(info);
  return handler ? { kind: "preview", handler } : { kind: "unsupported" };
}

export interface PreviewGrant {
  token: string;
  url: string;
  info: FileTypeInfo;
}

/** Owns at most one preview grant. A late grant for an old path is revoked
 * immediately instead of replacing the current one. */
export class PreviewGrantStore {
  private token: string | null = null;
  private epoch = 0;

  async acquire(info: FileTypeInfo, background = false): Promise<PreviewGrant | null> {
    this.release();
    const epoch = this.epoch;
    const { token, info: currentInfo } = await previewGrant(info.path, background);
    if (epoch !== this.epoch) {
      void previewRevoke(token).catch(() => undefined);
      return null;
    }
    this.token = token;
    return { token, url: fileUrl(token, currentInfo.name), info: currentInfo };
  }

  release(): void {
    this.epoch += 1;
    const token = this.token;
    this.token = null;
    if (token) void previewRevoke(token).catch(() => undefined);
  }
}

export interface PreviewCallbacks {
  onOpen: () => Promise<void>;
  onStatus?: (status: FileTabStatus) => void;
  onOpenHelp?: (slug: string) => void;
}

/** The handler props a preview may receive. `savedState` stays untouched
 * and view state writes are dropped: nothing from a preview is persisted. */
export function previewViewProps(
  info: FileTypeInfo,
  url: string,
  active: boolean,
  callbacks: PreviewCallbacks,
  find: HandlerViewProps["find"] = { text: "", request: 0, backwards: false },
): HandlerViewProps {
  return {
    info,
    url,
    active,
    savedState: null,
    onStateChange: () => undefined,
    onStatus: callbacks.onStatus ?? (() => undefined),
    onOpenInWindowsApp: () => {
      void callbacks.onOpen();
    },
    find: { text: find.text, request: find.request, backwards: find.backwards, ...(find.options ? { options: find.options } : {}) },
    protectedView: info.from_internet,
    previewOnly: true,
  };
}
