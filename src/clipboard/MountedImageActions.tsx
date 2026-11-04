import { Disc, FolderOpen, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import ProgressBar from "../components/ProgressBar";
import {
  canMountDiskImage,
  diskImageKindFromName,
  ejectDiskImage,
  listMountedImages,
  mountDiskImage,
  type MountedImage,
} from "../services/diskImages";
import { errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import type { MountResult } from "../services/diskImages";

/** Mount and eject one disk image (Step 09j T6). The component never
 * opens a drive by itself: `onOpenDrive` is the coordinator's normal
 * `openFolderTab` route, so the mounted volume behaves like any folder. */
export interface MountedImageActionsProps {
  path: string;
  name: string;
  onMounted?: (image: MountedImage) => void;
  onEjected?: (mountId: string) => void;
  onOpenDrive?: (root: string) => void;
  /** Open the new drive right away (default). A details pane keeps the
   * eject control visible instead and lets Open drive do it. */
  openOnMount?: boolean;
}

type Phase = "idle" | "mounting" | "confirmElevation" | "mounted" | "ejecting" | "error";

export default function MountedImageActions({
  path,
  name,
  onMounted,
  onEjected,
  onOpenDrive,
  openOnMount = true,
}: MountedImageActionsProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [mount, setMount] = useState<MountedImage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [elapsed, setElapsed] = useState(0);
  // `null` while the native mount registry is being probed. Mounting stays
  // disabled until the app really owns a `DiskMounts` state with its open
  // document adapter; a missing registry never looks like a working feature.
  const [available, setAvailable] = useState<boolean | null>(null);
  const mountRef = useRef<JobHandle<MountResult> | null>(null);
  const ejectRef = useRef<JobHandle<{ ejected: boolean }> | null>(null);
  // Incremented whenever the dialog is closed or unmounted, so a job that
  // finishes afterwards cannot reopen the dialog or override its phase.
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void listMountedImages()
      .then(() => {
        if (!cancelled) setAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      // Closing the tab never leaves a job polling behind (P-28).
      attemptRef.current += 1;
      void mountRef.current?.cancel().catch(() => undefined);
      void ejectRef.current?.cancel().catch(() => undefined);
    },
    [],
  );

  const startMount = async (allowElevation: boolean) => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setPhase("mounting");
    setError(null);
    setElapsed(0);
    try {
      const handle = await mountDiskImage(
        { path, readonly: true, allow_elevation: allowElevation },
        (progress) => {
          if (attemptRef.current === attempt) setElapsed(progress.items_done);
        },
      );
      if (attemptRef.current !== attempt) {
        void handle.cancel().catch(() => undefined);
        return;
      }
      mountRef.current = handle;
      const result = await handle.completion;
      if (attemptRef.current !== attempt) return;
      mountRef.current = null;
      if (result.requires_elevation && !allowElevation) {
        setPhase("confirmElevation");
        return;
      }
      if (result.mount) {
        setMount(result.mount);
        setPhase("mounted");
        onMounted?.(result.mount);
        const root = result.mount.volume_roots[0];
        if (root && openOnMount) onOpenDrive?.(root);
        return;
      }
      setError(result.error_code ?? "disk.unavailable");
      setPhase("error");
    } catch (reason) {
      if (attemptRef.current !== attempt) return;
      mountRef.current = null;
      setError(reason);
      setPhase("error");
    }
  };

  const eject = async () => {
    if (!mount || !mount.owned) return;
    setPhase("ejecting");
    setError(null);
    try {
      const handle = await ejectDiskImage(mount.mount_id);
      ejectRef.current = handle;
      await handle.completion;
      ejectRef.current = null;
      onEjected?.(mount.mount_id);
      setMount(null);
      setPhase("idle");
    } catch (reason) {
      ejectRef.current = null;
      setError(reason);
      setPhase("mounted");
    }
  };

  const supported = canMountDiskImage(name);
  const kind = diskImageKindFromName(name);
  const closeDialog = () => {
    if (phase === "mounting") {
      attemptRef.current += 1;
      void mountRef.current?.cancel().catch(() => undefined);
    }
    if (phase === "ejecting") return;
    setPhase("idle");
  };

  if (phase === "idle") {
    if (mount) {
      // The progress dialog can be closed without losing the mount; the
      // drive stays open and can be reached again or ejected here.
      return (
        <div className="adp-dialog-actions adp-disk-mounted">
          <span className="adp-disk-title">{name}</span>
          <span className="adp-disk-readonly">{t("disk.readOnly")}</span>
          <span className="adp-disk-roots">
            {mount.volume_roots.join(", ") || mount.physical_path}
          </span>
          {!mount.owned ? <span className="adp-disk-warning">{t("disk.external")}</span> : null}
          {error ? <span role="alert">{errorText(t, error, "disk")}</span> : null}
          <Button
            disabled={!mount.volume_roots[0]}
            onClick={() => mount.volume_roots[0] && onOpenDrive?.(mount.volume_roots[0])}
          >
            <FolderOpen size={16} aria-hidden="true" />
            {t("disk.openDrive")}
          </Button>
          {mount.owned ? (
            <Button variant="primary" onClick={() => void eject()}>
              <LogOut size={16} aria-hidden="true" />
              {t("disk.eject")}
            </Button>
          ) : null}
        </div>
      );
    }
    const disabled = !supported || available !== true;
    const title = !supported
      ? t("errors.disk.unsupported")
      : available === false
        ? t("errors.disk.unavailable")
        : undefined;
    return (
      <Button
        variant="default"
        disabled={disabled}
        title={title}
        onClick={() => void startMount(false)}
      >
        <Disc size={16} aria-hidden="true" />
        {t("disk.mount")}
        {kind ? <span className="adp-disk-kind">{kind.toUpperCase()}</span> : null}
      </Button>
    );
  }

  if (phase === "confirmElevation") {
    return (
      <Dialog title={t("disk.mount")} onClose={() => setPhase("idle")}>
        <p>{t("disk.elevate")}</p>
        <p className="adp-disk-warning">{t("disk.readOnly")}</p>
        <div className="adp-dialog-actions">
          <Button onClick={() => setPhase("idle")}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void startMount(true)}>
            {t("disk.continue")}
          </Button>
        </div>
      </Dialog>
    );
  }

  if (phase === "error") {
    return (
      <Dialog title={t("disk.mount")} onClose={() => setPhase("idle")}>
        <p role="alert">{errorText(t, error, "disk")}</p>
        <div className="adp-dialog-actions">
          <Button onClick={() => setPhase("idle")}>{t("common.close")}</Button>
        </div>
      </Dialog>
    );
  }

  const mounting = phase === "mounting" || phase === "ejecting";
  return (
    <Dialog title={t("disk.mount")} onClose={closeDialog} className="adp-disk-dialog">
      <p className="adp-disk-title">{name}</p>
      <p className="adp-disk-readonly">{t("disk.readOnly")}</p>
      {mount ? (
        <>
          <p className="adp-disk-roots">
            {mount.volume_roots.join(", ") || mount.physical_path}
          </p>
          {!mount.owned ? <p className="adp-disk-warning">{t("disk.external")}</p> : null}
        </>
      ) : null}
      {mounting ? (
        <>
          <ProgressBar label={t("disk.mount")} value={phase === "mounting" ? (elapsed / 10) * 100 : undefined} />
          <p className="adp-disk-elapsed">
            {t("disk.waiting", { seconds: Math.min(10, Math.max(0, Math.round(10 - elapsed))) })}
          </p>
        </>
      ) : null}
      {error ? <p role="alert">{errorText(t, error, "disk")}</p> : null}
      <div className="adp-dialog-actions">
        {phase === "mounting" ? (
          <Button
            onClick={() => {
              attemptRef.current += 1;
              void mountRef.current?.cancel().catch(() => undefined);
              setPhase("idle");
            }}
          >
            {t("common.cancel")}
          </Button>
        ) : (
          <>
            <Button disabled={phase === "ejecting"} onClick={closeDialog}>
              {t("common.close")}
            </Button>
            {mount ? (
              <>
                <Button
                  onClick={() => mount.volume_roots[0] && onOpenDrive?.(mount.volume_roots[0])}
                >
                  <FolderOpen size={16} aria-hidden="true" />
                  {t("disk.openDrive")}
                </Button>
                {mount.owned ? (
                  <Button variant="primary" disabled={phase === "ejecting"} onClick={() => void eject()}>
                    <LogOut size={16} aria-hidden="true" />
                    {t("disk.eject")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
