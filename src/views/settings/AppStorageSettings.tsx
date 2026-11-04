import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import HelpButton from "../../components/HelpButton";
import Skeleton from "../../components/Skeleton";
import { errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import {
  installPack,
  listPacks,
  pausePackDownload,
  refreshPackCatalog,
  removePack,
  resumePackDownload,
} from "../../services/packs";
import type {
  PackId,
  PackState,
  StorageCategory,
  StorageReport,
} from "../../services/packTypes";
import { clearStorage, setStorageLimit, storageReport } from "../../services/storage";
import StorageRows from "../../storage/StorageRows";
import PackCard from "./PackCard";

export interface AppStorageSettingsProps {
  onOpenHelp: (slug: string) => void;
}

/** Settings > App storage (Step 12a): optional packs and every owned store. */
export default function AppStorageSettings({ onOpenHelp }: AppStorageSettingsProps) {
  const { t, i18n } = useTranslation();
  const [packs, setPacks] = useState<PackState[]>([]);
  const [reports, setReports] = useState<StorageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPack, setBusyPack] = useState<PackId | null>(null);
  const [busyStorage, setBusyStorage] = useState<StorageCategory | null>(null);
  const [busyCatalog, setBusyCatalog] = useState(false);
  const [clearCategory, setClearCategory] = useState<StorageCategory | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PackState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busyPacks = useRef(new Set<PackId>());
  const busyClear = useRef(false);
  const clearTrigger = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextPacks, nextReports] = await Promise.all([listPacks(), storageReport()]);
      setPacks(nextPacks);
      setReports(nextReports);
      setError(null);
    } catch (caught) {
      setError(errorText(t, caught, "storage"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runPack = async (id: PackId, start: () => Promise<{ completion: Promise<unknown> }>) => {
    if (busyPacks.current.has(id)) return;
    busyPacks.current.add(id);
    setBusyPack(id);
    setMessage(null);
    try {
      const handle = await start();
      await handle.completion;
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "packs"));
    } finally {
      busyPacks.current.delete(id);
      setBusyPack(null);
    }
  };

  const install = (id: PackId) => {
    const version = packs.find((pack) => pack.id === id)?.available_version;
    if (!version) return;
    void runPack(id, () => installPack(id, version));
  };

  const resume = (id: PackId) => {
    void runPack(id, () => resumePackDownload(id));
  };

  const pause = async (id: PackId) => {
    try {
      await pausePackDownload(id);
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "packs"));
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    await runPack(target.id, () => removePack(target.id));
  };

  const refreshCatalog = async () => {
    if (busyCatalog) return;
    setBusyCatalog(true);
    setError(null);
    try {
      const handle = await refreshPackCatalog();
      await handle.completion;
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "packs"));
    } finally {
      setBusyCatalog(false);
    }
  };

  const openClear = (category: StorageCategory, trigger: HTMLElement | null) => {
    clearTrigger.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setClearCategory(category);
  };

  const closeClear = () => {
    setClearCategory(null);
    clearTrigger.current?.focus();
  };

  const confirmClear = async () => {
    const category = clearCategory;
    if (!category || busyClear.current) return;
    busyClear.current = true;
    setBusyStorage(category);
    try {
      const handle = await clearStorage(category);
      const result = await handle.completion;
      setMessage(
        result.pending_bytes > 0
          ? t("storage.clearedPending", {
              size: formatSize(result.pending_bytes, i18n.language),
            })
          : t("storage.cleared", { size: formatSize(result.freed_bytes, i18n.language) }),
      );
      setClearCategory(null);
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "storage"));
    } finally {
      busyClear.current = false;
      setBusyStorage(null);
      clearTrigger.current?.focus();
    }
  };

  const changeLimit = async (category: StorageCategory, bytes: number) => {
    try {
      await setStorageLimit(category, bytes);
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "storage"));
    }
  };

  if (loading) {
    return (
      <section className="adp-settings-section" aria-labelledby="adp-appstorage-title">
        <h3 id="adp-appstorage-title" className="adp-heading">
          {t("storage.title")}
        </h3>
        <Skeleton count={3} />
      </section>
    );
  }

  return (
    <section className="adp-settings-section" aria-labelledby="adp-appstorage-title">
      <div className="adp-view-header">
        <h3 id="adp-appstorage-title" className="adp-heading">
          {t("storage.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("app-storage")} />
      </div>
      {error ? (
        <p className="adp-note" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="adp-note" role="status">
          {message}
        </p>
      ) : null}

      <div className="adp-appstorage-heading-row">
        <h4 className="adp-heading">{t("packs.title")}</h4>
        <Button variant="subtle" disabled={busyCatalog} onClick={() => void refreshCatalog()}>
          {t("packs.refresh")}
        </Button>
      </div>
      <div className="adp-pack-list">
        {packs.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            busy={busyPack === pack.id}
            onInstall={install}
            onUpdate={install}
            onRemove={(id) => {
              const target = packs.find((pack) => pack.id === id);
              if (target) setRemoveTarget(target);
            }}
            onPause={(id) => void pause(id)}
            onResume={resume}
          />
        ))}
      </div>

      <h4 className="adp-heading adp-appstorage-subtitle">{t("storage.storedData")}</h4>
      <StorageRows
        reports={reports}
        busyCategory={busyStorage}
        onClear={(category) =>
          openClear(
            category,
            document.querySelector<HTMLElement>(`[data-storage-clear="${category}"]`),
          )
        }
        onSetLimit={(category, bytes) => void changeLimit(category, bytes)}
      />

      {clearCategory ? (
        <Dialog
          title={t("storage.clearTitle", {
            category: t(`storage.category.${clearCategory}`),
          })}
          className="adp-appstorage-clear-dialog"
          onClose={closeClear}
        >
          <p className="adp-dialog-text">
            {t("storage.clearConfirm", {
              category: t(`storage.category.${clearCategory}`),
              loss: t(
                reports.find((row) => row.category === clearCategory)?.loss_key ??
                  "storage.lossCache",
              ),
            })}
          </p>
          <div className="adp-dialog-actions">
            <Button disabled={busyStorage !== null} onClick={() => void confirmClear()}>
              {t("storage.clearAction")}
            </Button>
            <Button variant="primary" autoFocus onClick={closeClear}>
              {t("common.cancel")}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {removeTarget ? (
        <Dialog
          title={t("packs.removeTitle", { name: t(`packs.${removeTarget.id}.name`) })}
          onClose={() => setRemoveTarget(null)}
        >
          <p className="adp-dialog-text">
            {removeTarget.leased_count > 0 ? t("packs.inUse") : t("packs.removeConfirm")}
          </p>
          <div className="adp-dialog-actions">
            <Button onClick={() => void confirmRemove()}>{t("packs.remove")}</Button>
            <Button variant="primary" autoFocus onClick={() => setRemoveTarget(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

/** A feature that needs a missing pack links here, never to a guessed path. */
export function MissingPackNotice({
  packId,
  onOpenStorage,
}: {
  packId: PackId;
  onOpenStorage: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="adp-pack-missing" role="note">
      <p>{t("packs.missing")}</p>
      <p className="adp-note">{t(`packs.${packId}.name`)}</p>
      <Button onClick={onOpenStorage}>{t("packs.openStorage")}</Button>
    </div>
  );
}

