import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../services/errors";
import { formatDate } from "../services/format";
import { versionsRestore, type RestoreResult, type VersionInfo, type VersionList } from "../services/versions";

interface RestoreOptions {
  path: string;
  currentModified: number;
  currentSize: number;
  allowUndo: boolean;
  onRestored: (result: RestoreResult, version: VersionInfo) => void | Promise<void>;
  refresh: () => Promise<VersionList | null>;
}

/** Restore and its editor-only Undo share the same checked backend operation. */
export function useVersionRestore(options: RestoreOptions) {
  const { t, i18n } = useTranslation();
  const [confirmVersion, setConfirmVersion] = useState<VersionInfo | null>(null);
  const [undoVersion, setUndoVersion] = useState<VersionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);

  const perform = async (version: VersionInfo, offerUndo: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let restored = false;
    try {
      const result = await versionsRestore(options.path, version.id);
      restored = true;
      setConfirmVersion(null);
      const priorId = result.previous_id;
      const previous: VersionInfo | null =
        offerUndo && options.allowUndo && priorId !== null
          ? {
              id: priorId,
              created_unix: Math.floor(Date.now() / 1000),
              reason: "restore",
              size: options.currentSize,
              file_modified_unix: options.currentModified,
            }
          : null;
      // Disk has already changed. Keep its recovery ID even if the callback
      // cannot refresh the editor or a later history request fails.
      setUndoVersion(previous);
      await options.onRestored(result, version);
      const fresh = await options.refresh();
      if (previous) setUndoVersion(fresh?.versions.find((entry) => entry.id === priorId) ?? previous);
      setNotice(t("versions.restored", { date: formatDate(version.created_unix, i18n.language) }));
    } catch (error) {
      setConfirmVersion(null);
      const changed = restored ? `${t("versions.restored", { date: formatDate(version.created_unix, i18n.language) })} ` : "";
      setNotice(changed + errorText(t, error, "versions"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return {
    confirmVersion,
    setConfirmVersion,
    busy,
    notice,
    setNotice,
    canUndo: undoVersion !== null,
    confirmRestore: (version: VersionInfo) => perform(version, true),
    undoRestore: () => undoVersion ? perform(undoVersion, false) : Promise.resolve(),
  };
}
