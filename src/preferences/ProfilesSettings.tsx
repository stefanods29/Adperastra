/** Settings > Profiles (Step 10c T4/T5, E7).
 *
 * A profile switch is an explicit, non-undoable controlled restart. The
 * component only confirms it; the host coordinator asks for dirty decisions,
 * finishes jobs, locks sensitive containers and flushes state first.
 */
import { ArrowLeftRight, Check, Copy, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import { displayPath } from "../services/explorer";
import { errorCode, errorText } from "../services/errors";
import {
  DEFAULT_PROFILE_ID,
  normalizeProfileName,
  type PortableCopyRequest,
  type ProfileCatalog,
  type ProfileRoot,
} from "../services/profiles";
import PortableCopyDialog from "./PortableCopyDialog";

export interface ProfilesSettingsProps {
  catalog: ProfileCatalog;
  root: ProfileRoot;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  /** Runs the dirty-safe switch. Omit while the host has no safety guard so
   * the action stays visibly disabled instead of touching the catalog. */
  onSwitch?: (id: string) => Promise<void>;
  /** Host-owned copy action; omit so the dialog runs the verified shared job
   * itself, with progress and Cancel. */
  onPortableCopy?: (request: PortableCopyRequest) => Promise<void>;
  onOpenHelp: (slug: string) => void;
  /** Optional folder picker for the portable copy destination. */
  onChoosePortableDestination?: () => Promise<string | null>;
  /** Offered after a complete copy; the app restarts with the new data. */
  onRestartWithCopy?: () => Promise<void>;
  /** Host opens the T6 dialog itself (progress and Cancel inside it). */
  onOpenPortableCopy?: () => void;
}

type NameDialog = { kind: "create" } | { kind: "rename"; id: string; name: string };

export default function ProfilesSettings({
  catalog,
  root,
  onCreate,
  onRename,
  onSwitch,
  onPortableCopy,
  onOpenHelp,
  onChoosePortableDestination,
  onRestartWithCopy,
  onOpenPortableCopy,
}: ProfilesSettingsProps) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  const [name, setName] = useState("");
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const path = displayPath(root.profile_dir);
  const active = catalog.profiles.find((profile) => profile.id === catalog.active_id);
  const switching = catalog.profiles.find((profile) => profile.id === switchId);
  const displayName = (profile: { id: string; name: string }) =>
    profile.id === DEFAULT_PROFILE_ID && profile.name === "Default"
      ? t("profiles.defaultName")
      : profile.name;
  const validName = normalizeProfileName(name) !== null;

  const openCreate = () => {
    setError(null);
    setName("");
    setDialog({ kind: "create" });
  };

  const openRename = (id: string, current: string) => {
    setError(null);
    setName(current);
    setDialog({ kind: "rename", id, name: current });
  };

  const submitName = async () => {
    if (dialog === null) return;
    setBusy(true);
    setError(null);
    try {
      if (dialog.kind === "create") await onCreate(name);
      else await onRename(dialog.id, name);
      setDialog(null);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirmSwitch = async () => {
    if (switchId === null || !onSwitch) return;
    setBusy(true);
    setError(null);
    try {
      await onSwitch(switchId);
      setSwitchId(null);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard?.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("profiles.io");
    }
  };

  return (
    <section className="adp-settings-section adp-preferences-section" aria-labelledby="adp-profiles-title">
      <div className="adp-view-header">
        <h3 id="adp-profiles-title" className="adp-heading">
          {t("profiles.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("profiles-and-portable-data")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("profiles.current")}</span>
        <div className="adp-profiles-path">
          <span className="adp-profiles-path-text" dir="ltr">
            {path}
          </span>
          <IconButton
            icon={copied ? Check : Copy}
            labelKey={copied ? "profiles.pathCopied" : "profiles.copyPath"}
            onClick={() => void copyPath()}
          />
        </div>
      </div>
      {error !== null && dialog === null && switchId === null ? (
        <p className="adp-note adp-note--error" role="alert">
          {errorText(t, error, "profiles")}
        </p>
      ) : null}
      <ul className="adp-profiles-list" role="list">
        {catalog.profiles.map((profile) => {
          const isActive = profile.id === catalog.active_id;
          return (
            <li
              key={profile.id}
              className={isActive ? "adp-profiles-row adp-profiles-row--active" : "adp-profiles-row"}
              role="listitem"
            >
              <span className="adp-profiles-name">
                {isActive ? <Check size={16} aria-hidden="true" /> : null}
                {displayName(profile)}
              </span>
              {isActive ? (
                <span className="adp-note">{t("profiles.active")}</span>
              ) : (
                <span className="adp-button-row">
                  <Button variant="subtle" onClick={() => openRename(profile.id, profile.name)}>
                    <Pencil size={16} aria-hidden="true" /> {t("profiles.rename")}
                  </Button>
                  <Button
                    variant="subtle"
                    disabled={!onSwitch}
                    title={onSwitch ? undefined : t("profiles.restartWarning")}
                    onClick={() => {
                      setError(null);
                      setSwitchId(profile.id);
                    }}
                  >
                    <ArrowLeftRight size={16} aria-hidden="true" /> {t("profiles.switch")}
                  </Button>
                </span>
              )}
              {isActive ? (
                <Button variant="subtle" onClick={() => openRename(profile.id, profile.name)}>
                  <Pencil size={16} aria-hidden="true" /> {t("profiles.rename")}
                </Button>
              ) : null}
              {catalog.pending_id === profile.id ? (
                <span className="adp-note">{t("profiles.restartPending")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="adp-button-row">
        <Button onClick={openCreate}>
          <Plus size={16} aria-hidden="true" /> {t("profiles.create")}
        </Button>
      </div>
      <div className="adp-settings-block">
        <h4 className="adp-heading">{t("profiles.portable")}</h4>
        <p className="adp-note">{t("profiles.portableNote")}</p>
        <div className="adp-setting-row">
          <span className="adp-setting-label">{t("profiles.baseFolder")}</span>
          <span className="adp-profiles-path-text" dir="ltr">
            {displayPath(root.base_dir)}
          </span>
        </div>
        <p className="adp-note">{t("profiles.keepOriginal")}</p>
        <Button
          onClick={() => {
            if (onOpenPortableCopy) onOpenPortableCopy();
            else setCopyOpen(true);
          }}
        >
          {t("profiles.copy")}
        </Button>
      </div>
      {dialog ? (
        <Dialog
          title={dialog.kind === "create" ? t("profiles.create") : t("profiles.rename")}
          onClose={() => {
            setDialog(null);
            setError(null);
          }}
        >
          <label className="adp-setting-label" htmlFor="adp-profile-name">
            {t("profiles.name")}
          </label>
          <input
            id="adp-profile-name"
            className="adp-input"
            value={name}
            aria-invalid={name !== "" && !validName}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          {error !== null ? (
            <p className="adp-note adp-note--error" role="alert">
              {errorText(t, error, "profiles")}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              disabled={busy || !validName}
              onClick={() => void submitName()}
            >
              {dialog.kind === "create" ? t("profiles.create") : t("profiles.rename")}
            </Button>
            <Button
              onClick={() => {
                setDialog(null);
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </Dialog>
      ) : null}
      {switchId !== null ? (
        <Dialog
          title={t("profiles.switch")}
          className="adp-profiles-switch-dialog"
          onClose={() => {
            setSwitchId(null);
            setError(null);
          }}
        >
          <p>{t("profiles.restartWarning")}</p>
          {switching ? <p className="adp-note">{displayName(switching)}</p> : null}
          {error !== null ? (
            <p className="adp-note adp-note--error" role="alert">
              {errorText(t, error, "profiles")}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              disabled={busy || !onSwitch}
              onClick={() => void confirmSwitch()}
            >
              {t("profiles.switch")}
            </Button>
            <Button
              autoFocus
              onClick={() => {
                setSwitchId(null);
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </Dialog>
      ) : null}
      {copyOpen ? (
        <PortableCopyDialog
          baseDir={root.base_dir}
          onChooseDestination={onChoosePortableDestination}
          onCopy={onPortableCopy}
          onClose={() => setCopyOpen(false)}
          onOpenHelp={onOpenHelp}
          onRestart={onRestartWithCopy}
        />
      ) : null}
      {active ? null : (
        <p className="adp-note adp-note--error" role="alert">
          {t("errors.profiles.invalid")}
        </p>
      )}
    </section>
  );
}
