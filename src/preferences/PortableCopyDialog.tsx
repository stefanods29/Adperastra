/** Make a verified portable copy of the app data (Step 10c T6, E6).
 *
 * The destination must be a new or empty folder. The native job preflights
 * space, copies through owned staging, hashes every file and publishes a
 * manifest last. The original data is never moved, merged or deleted.
 */
import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import Switch from "../components/Switch";
import { errorCode, errorText } from "../services/errors";
import { formatSize } from "../services/format";
import type { OpProgress } from "../services/fileops";
import type { JobHandle } from "../services/jobs";
import {
  copyPortableData,
  type PortableCopyReport,
  type PortableCopyRequest,
} from "../services/profiles";

export interface PortableCopyDialogProps {
  /** The effective app-data base shown to the user. */
  baseDir: string;
  /** Opens a folder picker; a text field remains available without one. */
  onChooseDestination?: () => Promise<string | null>;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
  /** Host-owned copy action; when omitted, the shared E6 job runs here. */
  onCopy?: (request: PortableCopyRequest) => Promise<void>;
  /** Offered after a complete copy; the app restarts with the new data. */
  onRestart?: () => Promise<void>;
}

const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const PARENT_PART_RE = /(^|[\\/])\.\.([\\/]|$)/;

function plainPath(path: string): string {
  let raw = path.replace(/[\\/]+/g, "\\");
  if (raw.startsWith("\\\\?\\UNC\\")) raw = `\\\\${raw.slice(8)}`;
  else if (raw.startsWith("\\\\?\\")) raw = raw.slice(4);
  return raw.replace(/\\+$/, "").toLowerCase();
}

function samePathText(a: string, b: string): boolean {
  return plainPath(a) === plainPath(b);
}

/** True when `child` is strictly below `parent` after lexical cleanup. */
function insidePath(parent: string, child: string): boolean {
  const cleanParent = plainPath(parent);
  const cleanChild = plainPath(child);
  return (
    cleanChild.length > cleanParent.length &&
    cleanChild.startsWith(cleanParent) &&
    cleanChild.charAt(cleanParent.length) === "\\"
  );
}

export default function PortableCopyDialog({
  baseDir,
  onChooseDestination,
  onClose,
  onOpenHelp,
  onCopy,
  onRestart,
}: PortableCopyDialogProps) {
  const { t, i18n } = useTranslation();
  const [destination, setDestination] = useState("");
  const [includePacks, setIncludePacks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OpProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PortableCopyReport | null>(null);
  const [done, setDone] = useState(false);
  const handle = useRef<JobHandle<PortableCopyReport> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void handle.current?.cancel();
      handle.current = null;
    };
  }, []);

  const destinationValid = (path: string): boolean =>
    ABSOLUTE_PATH_RE.test(path) &&
    !PARENT_PART_RE.test(path) &&
    !samePathText(path, baseDir) &&
    !insidePath(baseDir, path) &&
    !insidePath(path, baseDir);

  const request = (): PortableCopyRequest | null => {
    const path = destination.trim();
    if (!destinationValid(path)) {
      setError(t("errors.profiles.copy_failed"));
      return null;
    }
    return {
      dest_dir: path,
      include_packs: includePacks,
      expected_base: baseDir,
      nooverwrite: true,
    };
  };

  const choose = async () => {
    if (!onChooseDestination) return;
    try {
      const chosen = await onChooseDestination();
      if (chosen !== null) setDestination(chosen);
    } catch (caught) {
      if (mounted.current) setError(errorText(t, errorCode(caught), "profiles"));
    }
  };

  const start = async () => {
    const built = request();
    if (built === null) return;
    setError(null);
    setReport(null);
    setDone(false);
    setBusy(true);
    setProgress(null);
    try {
      if (onCopy) {
        await onCopy(built);
        if (!mounted.current) return;
        setDone(true);
      } else {
        const running = await copyPortableData(built, (next) => {
          if (mounted.current) setProgress(next);
        });
        handle.current = running;
        const result = await running.completion;
        if (!mounted.current) return;
        if (result.complete) {
          setReport(result);
          setDone(true);
        } else {
          setReport(result);
          setError(t("errors.profiles.copy_failed"));
        }
      }
    } catch (caught) {
      if (!mounted.current) return;
      setError(errorText(t, errorCode(caught), "profiles"));
    } finally {
      handle.current = null;
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const cancel = async () => {
    await handle.current?.cancel();
    handle.current = null;
    setBusy(false);
    setProgress(null);
  };

  const close = async () => {
    // A host-owned copy has no local handle to cancel; do not hide it.
    if (busy && onCopy) return;
    await cancel();
    onClose();
  };

  return (
    <Dialog title={t("profiles.copy")} onClose={() => void close()} className="adp-portable-copy">
      <p>{t("profiles.copyIntro")}</p>
      <p className="adp-note">{t("profiles.keepOriginal")}</p>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-portable-destination">
          {t("profiles.chooseFolder")}
        </label>
        <div className="adp-portable-destination">
          <input
            id="adp-portable-destination"
            className="adp-input"
            dir="ltr"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            aria-invalid={destination !== "" && !destinationValid(destination.trim())}
          />
          {onChooseDestination ? (
            <Button variant="subtle" onClick={() => void choose()}>
              <FolderOpen size={16} aria-hidden="true" /> {t("profiles.browse")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={includePacks}
          label={t("profiles.includePacks")}
          onChange={setIncludePacks}
        />
      </div>
      {busy && progress !== null ? (
        <p className="adp-note" role="status">
          {t("profiles.copying", { done: progress.items_done, total: progress.items_total })}
        </p>
      ) : null}
      {busy && progress === null ? (
        <p className="adp-note" role="status">
          {t("profiles.copying", { done: 0, total: 0 })}
        </p>
      ) : null}
      {error !== null ? (
        <p className="adp-note adp-note--error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <div className="adp-note" role="status">
          <p>{t("profiles.copyDone")}</p>
          {report ? (
            <p>
              {t("profiles.copySummary", {
                files: report.files_copied,
                size: formatSize(report.bytes_copied, i18n.language === "pseudo" ? "en" : i18n.language),
              })}
            </p>
          ) : null}
          <p dir="ltr">{report?.dest_dir ?? destination}</p>
        </div>
      ) : null}
      <div className="adp-dialog-actions">
        {busy ? (
          onCopy ? null : <Button onClick={() => void cancel()}>{t("common.cancel")}</Button>
        ) : (
          <>
            <Button variant="primary" disabled={destination === "" || done} onClick={() => void start()}>
              {t("profiles.copy")}
            </Button>
            <Button onClick={() => void close()}>{t("common.close")}</Button>
            {done && onRestart ? (
              <Button
                variant="primary"
                onClick={() => {
                  void onRestart();
                }}
              >
                {t("profiles.restartWithCopy")}
              </Button>
            ) : null}
          </>
        )}
        <Button variant="subtle" onClick={() => onOpenHelp("profiles-and-portable-data")}>
          {t("help.title")}
        </Button>
      </div>
    </Dialog>
  );
}
