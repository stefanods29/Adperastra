import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Skeleton from "../../components/Skeleton";
import type { DocumentHandle, DocumentRef } from "../../documents/types";
import { DocumentRegistry } from "../../documents/DocumentRegistry";
import { acquireTimeline, type TimelineController } from "../../timeline/TimelineDocument";
import TimelineEditor from "../../timeline/TimelineEditor";
import { timelineErrorCode } from "../../timeline/types";
import type { HandlerViewProps } from "../types";

/**
 * Hosts the timeline editor inside a file tab. It acquires the shared 09a
 * document, installs the timeline controller once, and hands save/discard to
 * the document handle. Nothing here writes the project file directly.
 */
export default function TimelineProjectView(props: HandlerViewProps) {
  const { t } = useTranslation();
  const [controller, setController] = useState<TimelineController | null>(null);
  const [handle, setHandle] = useState<DocumentHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let documentHandle: DocumentHandle | null = null;
    let timeline: TimelineController | null = null;
    let unsubscribe: (() => void) | null = null;
    const ref: DocumentRef = { kind: "disk", path: props.info.path };
    void (async () => {
      try {
        documentHandle = await DocumentRegistry.acquire(ref);
        timeline = await acquireTimeline(documentHandle);
        if (disposed) {
          timeline.release();
          timeline = null;
          DocumentRegistry.release(documentHandle.id);
          return;
        }
        setHandle(documentHandle);
        setController(timeline);
        props.onDirtyChange?.(documentHandle.getState().dirty);
        unsubscribe = documentHandle.subscribe((state) => props.onDirtyChange?.(state.dirty));
        props.registerSave?.({
          save: () => documentHandle?.save() ?? Promise.resolve(false),
          discard: () => {
            void documentHandle?.discard();
          },
        });
      } catch (caught) {
        if (!disposed) setError(timelineErrorCode(caught));
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      props.registerSave?.(null);
      timeline?.release();
      if (documentHandle) DocumentRegistry.release(documentHandle.id);
    };
    // The view is one document; a path change remounts the tab in 09a.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.info.path]);

  const onStateChange = useCallback(
    (state: unknown) => props.onStateChange(state),
    [props.onStateChange],
  );

  if (error) {
    return (
      <div className="adp-timeline-load-error" role="alert" data-code={error}>
        <p>{t("errors.timeline.failed")}</p>
      </div>
    );
  }
  if (!controller || !handle) return <Skeleton variant="rows" count={4} />;
  if (props.protectedView) {
    return (
      <div className="adp-timeline-load-error" role="status">
        <p>{t("timeline.projectNotice")}</p>
      </div>
    );
  }
  return (
    <TimelineEditor
      documentId={handle.id}
      controller={controller}
      active={props.active}
      savedState={props.savedState}
      onStateChange={onStateChange}
      onStatus={props.onStatus}
      onOpenHelp={props.onOpenHelp}
    />
  );
}
