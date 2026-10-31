import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import Skeleton from "../components/Skeleton";
import { markdownHandler } from "../handlers/markdown";
import { textHandler } from "../handlers/text";
import { decodeText, detectEncoding } from "../handlers/text/encoding";
import { errorText } from "../services/errors";
import { extensionOf, fileGrant, fileRevoke, fileUrl } from "../services/files";
import { formatDate, formatSize } from "../services/format";
import {
  versionsExtract,
  versionsList,
  versionsRestore,
  versionsSaveCopy,
  type RestoreResult,
  type VersionInfo,
} from "../services/versions";
import { diffLines, splitLines, withContext, type DiffRow } from "./lineDiff";

/** Files at most this size (and versions of them) get a text preview. */
const TEXT_PREVIEW_MAX = 1_048_576;

/** How many rows the loading skeleton suggests. */
const SKELETON_ROWS = 4;

const REASON_KEYS: Record<string, string> = {
  save: "versions.reason.save",
  saveAs: "versions.reason.saveAs",
  restore: "versions.reason.restore",
};

function reasonText(t: TFunction, reason: string): string {
  return t(REASON_KEYS[reason] ?? "versions.reason.other");
}

function isTextLike(name: string): boolean {
  const extension = extensionOf(name);
  return textHandler.extensions.includes(extension) || markdownHandler.extensions.includes(extension);
}

/** Read a file through a one-time grant, then revoke it (R-SEC-5). */
async function readGranted(path: string, fileName: string): Promise<string> {
  const token = await fileGrant(path);
  try {
    const response = await fetch(fileUrl(token, fileName));
    if (!response.ok) throw new Error("versions.other");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const detected = detectEncoding(bytes);
    return decodeText(bytes, detected.encoding);
  } finally {
    await fileRevoke(token);
  }
}

function rowClass(row: DiffRow): string {
  return row.kind === "skip" ? "adp-diff-row adp-diff-row--skip" : `adp-diff-row adp-diff-row--${row.kind}`;
}

export interface VersionHistoryDialogProps {
  /** The file whose versions are shown. */
  path: string;
  /** Its name, used in the title and the save dialog. */
  name: string;
  currentModified: number;
  currentSize: number;
  /** Settings > Version history is on. */
  versionsEnabled: boolean;
  /** Opened from an editor with unsaved changes. */
  hasUnsavedChanges?: boolean;
  /** Open an extracted read-only copy in a tab. */
  onOpenCopy: (path: string) => void;
  /** After a restore, so the caller can refresh or reload. */
  onRestored: (result: RestoreResult, version: VersionInfo) => void;
  /** Open the file's Windows Properties (its Previous versions tab). */
  onShowWindowsVersions: () => void;
  onClose: () => void;
}

export default function VersionHistoryDialog({
  path,
  name,
  currentModified,
  currentSize,
  versionsEnabled,
  hasUnsavedChanges = false,
  onOpenCopy,
  onRestored,
  onShowWindowsVersions,
  onClose,
}: VersionHistoryDialogProps) {
  const { t, i18n } = useTranslation();
  const title = t("versions.title", { name });
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [tooLarge, setTooLarge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [listError, setListError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"changes" | "thisVersion">("changes");
  const [texts, setTexts] = useState<{ current: string; old: string } | null>(null);
  const [textsLoading, setTextsLoading] = useState(false);
  const [textsError, setTextsError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<VersionInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await versionsList(path);
      setVersions(result.versions);
      setTooLarge(result.too_large);
      setListError(null);
      setSelectedId(result.versions[0]?.id ?? null);
    } catch (error) {
      setListError(error);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 100);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const selectedVersion = versions.find((version) => version.id === selectedId) ?? null;
  const textPreview =
    selectedVersion !== null &&
    isTextLike(name) &&
    selectedVersion.size <= TEXT_PREVIEW_MAX &&
    currentSize <= TEXT_PREVIEW_MAX;

  useEffect(() => {
    if (selectedId === null || !isTextLike(name) || !textPreview) {
      setTexts(null);
      setTextsError(null);
      return;
    }
    let cancelled = false;
    setTexts(null);
    setTextsError(null);
    setTextsLoading(true);
    const versionId = selectedId;
    void (async () => {
      try {
        const current = await readGranted(path, name);
        const copy = await versionsExtract(versionId, name);
        const old = await readGranted(copy, name);
        if (!cancelled) setTexts({ current, old });
      } catch (error) {
        if (!cancelled) setTextsError(error);
      } finally {
        if (!cancelled) setTextsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, textPreview, path, name]);

  const rows = useMemo(() => {
    if (!texts) return null;
    const ops = diffLines(splitLines(texts.old), splitLines(texts.current));
    return ops === null ? null : withContext(ops);
  }, [texts]);

  const moveSelection = (index: number) => {
    if (versions.length === 0) return;
    const next = Math.min(versions.length - 1, Math.max(0, index));
    setSelectedId(versions[next].id);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (versions.length === 0) return;
    const index = versions.findIndex((version) => version.id === selectedId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection((index < 0 ? -1 : index) + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection((index < 0 ? 1 : index) - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveSelection(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveSelection(versions.length - 1);
    }
  };

  const openVersion = async () => {
    if (!selectedVersion) return;
    try {
      const copy = await versionsExtract(selectedVersion.id, name);
      onOpenCopy(copy);
    } catch (error) {
      setNotice(errorText(t, error, "versions"));
    }
  };

  const saveCopy = async () => {
    if (!selectedVersion) return;
    try {
      await versionsSaveCopy(selectedVersion.id, t("versions.saveCopyTitle"), name, t("versions.allFiles"));
    } catch (error) {
      setNotice(errorText(t, error, "versions"));
    }
  };

  const confirmRestore = async (version: VersionInfo) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await versionsRestore(path, version.id);
      setConfirmVersion(null);
      setNotice(t("versions.restored", { date: formatDate(version.created_unix, i18n.language) }));
      onRestored(result, version);
      await loadList();
    } catch (error) {
      setConfirmVersion(null);
      setNotice(errorText(t, error, "versions"));
    } finally {
      setBusy(false);
    }
  };

  const closeMain = useCallback(() => {
    if (confirmVersion) {
      setConfirmVersion(null);
      return;
    }
    onClose();
  }, [confirmVersion, onClose]);

  const changes = () => {
    if (textsError) {
      return <p className="adp-note">{errorText(t, textsError, "versions")}</p>;
    }
    if (textsLoading || !texts) {
      return <Skeleton count={SKELETON_ROWS} />;
    }
    if (rows === null) {
      return <p className="adp-note">{t("versions.tooManyChanges")}</p>;
    }
    if (rows.length === 0) {
      return <p className="adp-note">{t("versions.noChanges")}</p>;
    }
    return (
      <div className="adp-versions-diff">
        {rows.map((row, index) => (
          <div key={index} className={rowClass(row)}>
            {row.kind === "skip" ? t("versions.unchanged", { count: row.count }) : row.text || "\u00A0"}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <Dialog title={title} onClose={closeMain} className="adp-versions-dialog">
        <div className="adp-versions">
          <div className="adp-versions-side">
            {loading && slow ? <Skeleton count={SKELETON_ROWS} /> : null}
            <ul
              className="adp-versions-list"
              role="listbox"
              aria-label={title}
              tabIndex={0}
              onKeyDown={onListKeyDown}
              hidden={loading && slow}
            >
              <li className="adp-versions-row adp-versions-row--current">
                <span className="adp-versions-row-title">{t("versions.current")}</span>
                <span className="adp-versions-row-meta">
                  {formatDate(currentModified, i18n.language)} · {formatSize(currentSize, i18n.language)}
                </span>
              </li>
              {versions.map((version) => (
                <li
                  key={version.id}
                  role="option"
                  aria-selected={version.id === selectedId}
                  className={
                    version.id === selectedId
                      ? "adp-versions-row adp-versions-row--selected"
                      : "adp-versions-row"
                  }
                  onClick={() => setSelectedId(version.id)}
                >
                  <span className="adp-versions-row-title">
                    {formatDate(version.created_unix, i18n.language)}
                  </span>
                  <span className="adp-versions-row-meta">
                    {formatSize(version.size, i18n.language)} · {reasonText(t, version.reason)}
                  </span>
                </li>
              ))}
            </ul>
            {listError ? <p className="adp-note">{errorText(t, listError, "versions")}</p> : null}
            {!loading && versions.length === 0 ? (
              <p className="adp-note">{t("versions.empty")}</p>
            ) : null}
            {tooLarge ? <p className="adp-note">{t("versions.tooLarge")}</p> : null}
            {!versionsEnabled ? <p className="adp-note">{t("versions.off")}</p> : null}
          </div>
          <div className="adp-versions-detail">
            {selectedVersion ? (
              <>
                {textPreview ? (
                  <>
                    <div className="adp-versions-tabs">
                      <Button
                        variant={mode === "changes" ? "default" : "subtle"}
                        aria-pressed={mode === "changes"}
                        onClick={() => setMode("changes")}
                      >
                        {t("versions.changes")}
                      </Button>
                      <Button
                        variant={mode === "thisVersion" ? "default" : "subtle"}
                        aria-pressed={mode === "thisVersion"}
                        onClick={() => setMode("thisVersion")}
                      >
                        {t("versions.thisVersion")}
                      </Button>
                    </div>
                    {mode === "changes" ? (
                      changes()
                    ) : textsLoading ? (
                      <Skeleton count={SKELETON_ROWS} />
                    ) : texts ? (
                      <pre className="adp-versions-text">{texts.old}</pre>
                    ) : textsError ? (
                      <p className="adp-note">{errorText(t, textsError, "versions")}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="adp-dialog-note">{t("versions.noPreview")}</p>
                )}
                {notice ? (
                  <p className="adp-note" role="status">
                    {notice}
                  </p>
                ) : null}
                <div className="adp-dialog-actions">
                  <Button variant="subtle" onClick={onShowWindowsVersions}>
                    {t("versions.windowsVersions")}
                  </Button>
                  <span className="adp-versions-spacer" />
                  <Button onClick={() => void openVersion()}>{t("versions.open")}</Button>
                  <Button onClick={() => void saveCopy()}>{t("versions.saveCopy")}</Button>
                  <Button variant="primary" onClick={() => setConfirmVersion(selectedVersion)}>
                    {t("versions.restore")}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Dialog>
      {confirmVersion ? (
        <Dialog title={t("versions.restoreTitle")} onClose={() => setConfirmVersion(null)}>
          <p className="adp-dialog-text">
            {t("versions.restoreBody", {
              date: formatDate(confirmVersion.created_unix, i18n.language),
            })}
          </p>
          {hasUnsavedChanges ? <p className="adp-dialog-text">{t("versions.restoreUnsaved")}</p> : null}
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={() => void confirmRestore(confirmVersion)}>
              {t("versions.restore")}
            </Button>
            <Button onClick={() => setConfirmVersion(null)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
