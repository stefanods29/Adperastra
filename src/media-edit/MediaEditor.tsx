import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import Skeleton from "../components/Skeleton";
import TextInput from "../components/TextInput";
import type { ConversionReport } from "../convert/types";
import type { VirtualViewProps } from "../documents/types";
import type { JobHandle } from "../services/jobs";
import { fileDetect, fileGrant, fileRevoke, fileUrl } from "../services/files";
import type { MediaInfo } from "../services/mediaEngine";
import { probeMedia } from "../services/mediaEngine";
import type { MediaEditController } from "./MediaDocument";
import { acquireMediaEditor } from "./MediaDocument";
import { bindMediaDraftController } from "./MediaDraft";
import MediaEditorBody from "./MediaEditorBody";
import { mediaSourceForProbe } from "./sources";
import type { MediaRecipe } from "./types";
import { mediaEditFail } from "./types";
import { relinkMediaSource } from "./recipeCodec";
import { mediaRecipeDurationUs } from "./timing";

/**
 * The recipe editor (`T2`/`T3`/`T4`).
 *
 * The original media stays untouched: every control changes the document's
 * recipe, Save writes the recipe, and Export creates a separate media file.
 * The player reads the original source and skips removed ranges.
 */

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export default function MediaEditor(props: VirtualViewProps) {
  const { t } = useTranslation();
  const [controller, setController] = useState<MediaEditController | null>(null);
  const [recipe, setRecipe] = useState<MediaRecipe | null>(null);
  const [errorCode, setErrorCode] = useState("");
  const [sourceInfo, setSourceInfo] = useState<MediaInfo | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [exporting, setExporting] = useState<JobHandle<ConversionReport> | null>(null);
  const [relinkOpen, setRelinkOpen] = useState(false);
  const [relinkPath, setRelinkPath] = useState("");
  const sourcePath = recipe?.sources[0]?.path ?? null;
  const sourceStamp = recipe?.sources[0]?.stamp ?? null;

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let unbindDraft: () => void = () => undefined;
    acquireMediaEditor(props.document)
      .then((next) => {
        if (cancelled) {
          next.release();
          return;
        }
        unbindDraft = bindMediaDraftController(props.document, next);
        release = () => next.release();
        setController(next);
        setRecipe(next.getRecipe());
        unsubscribe = next.subscribe((value) => setRecipe(value));
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorCode(error instanceof Error ? error.message : "media_edit.failed");
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
      unbindDraft();
      release?.();
    };
  }, [props.document]);

  useEffect(() => {
    setSourceInfo(null);
    if (!sourcePath) return;
    let cancelled = false;
    let cancel = () => undefined;
    const expected = recipe?.sources[0]?.stamp ?? null;
    probeMedia({ kind: "file", path: sourcePath, expected: null })
      .then((job) => {
        if (cancelled) {
          void job.cancel();
          return Promise.reject(new Error("media_edit.failed"));
        }
        cancel = () => void job.cancel();
        return job.completion;
      })
      .then((info) => {
        if (cancelled) return;
        if (
          expected &&
          (info.source.file_id !== expected.file_id ||
            info.source.modified_ticks !== expected.modified_ticks ||
            info.source.size_bytes !== expected.size_bytes)
        ) {
          // The recipe points at a revision that no longer exists. Keep the
          // player usable but never compute crop bounds from another file.
          setErrorCode("media_edit.changed");
          return;
        }
        setSourceInfo(info);
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorCode(error instanceof Error ? error.message : "media_edit.failed");
      });
    return () => {
      cancelled = true;
      cancel();
    };
    // Re-probe only when the source path or its captured stamp changes; a
    // recipe edit keeps the same stamped source.
  }, [sourcePath, sourceStamp?.file_id, sourceStamp?.modified_ticks, sourceStamp?.size_bytes]);

  useEffect(() => {
    if (!sourcePath) {
      setSourceUrl("");
      return;
    }
    let cancelled = false;
    let token: string | null = null;
    fileGrant(sourcePath)
      .then((granted) => {
        token = granted;
        if (cancelled) {
          void fileRevoke(granted).catch(() => undefined);
          return;
        }
        setSourceUrl(fileUrl(granted, nameOf(sourcePath)));
      })
      .catch(() => {
        setSourceUrl("");
        setErrorCode("media_edit.missing_source");
      });
    return () => {
      cancelled = true;
      if (token) void fileRevoke(token).catch(() => undefined);
    };
  }, [sourcePath]);

  if (!recipe || !controller) {
    return errorCode ? (
      <div className="adp-viewer-message" role="alert">
        <p title={errorCode}>{t("errors.media_edit.failed")}</p>
      </div>
    ) : (
      <Skeleton variant="rows" count={5} />
    );
  }

  return (
    <>
      <MediaEditorBody
        document={props.document}
        controller={controller}
        recipe={recipe}
        active={props.active}
        sourceUrl={sourceUrl}
        sourceInfo={sourceInfo}
        durationUs={mediaRecipeDurationUs(recipe)}
        errorCode={errorCode}
        exporting={exporting}
        savedState={props.savedState}
        onStateChange={(state) => props.onStateChange(state as unknown as import("../documents/types").SerializableViewState)}
        onStatus={props.onStatus}
        onError={setErrorCode}
        onExporting={setExporting}
        onRelink={() => setRelinkOpen(true)}
      />
      {relinkOpen ? (
        <Dialog title={t("mediaEdit.relink")} onClose={() => setRelinkOpen(false)}>
          <div className="adp-media-dialog">
            <label className="adp-media-field">
              {t("mediaEdit.relink")}
              <TextInput value={relinkPath} onChange={setRelinkPath} ariaLabel={t("mediaEdit.relink")} />
            </label>
            <div className="adp-media-actions">
              <Button variant="subtle" onClick={() => setRelinkOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => {
                  const path = relinkPath.trim();
                  const currentRecipe = controller.getRecipe();
                  const current = currentRecipe.sources[0];
                  if (!current || !/^(?:[A-Za-z]:\\|\\\\)/.test(path)) {
                    setErrorCode("media_edit.bad_request");
                    return;
                  }
                  void fileDetect(path)
                    .then((info) => {
                      if (!info.mime.startsWith("video/") && !info.mime.startsWith("audio/")) {
                        mediaEditFail("media_edit.unsupported");
                      }
                      return probeMedia({ kind: "file", path, expected: null });
                    })
                    .then((job) => job.completion)
                    .then((info) => {
                      const replacement = mediaSourceForProbe(info);
                      // Compatible stream kinds and a long-enough duration
                      // are checked before the recipe keeps a single edit.
                      const result = relinkMediaSource(currentRecipe, current.id, replacement);
                      return controller.apply({
                        kind: "relink_source",
                        source_id: current.id,
                        replacement:
                          result.recipe.sources.find((candidate) => candidate.id === current.id) ?? replacement,
                      });
                    })
                    .then(() => {
                      setSourceInfo(null);
                      setErrorCode("");
                      setRelinkOpen(false);
                    })
                    .catch((error: unknown) => setErrorCode(error instanceof Error ? error.message : "media_edit.failed"));
                }}
              >
                {t("mediaEdit.relink")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
