/** Loads the profile catalog and root for Settings > Profiles (Step 10c).
 *
 * All native calls live in services; this host only sequences them and
 * keeps the catalog revision used by create/rename. A switch request is
 * delegated to the app's ProfileSwitchCoordinator, which must first make
 * the dirty-close decision, quiesce jobs, lock sensitive containers and
 * flush the session. When that coordinator is not available the switch
 * fails closed here; this component never calls the native prepare/commit
 * commands on its own.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Skeleton from "../components/Skeleton";
import { errorCode, errorText } from "../services/errors";
import {
  createProfile,
  getProfileRoot,
  listProfiles,
  renameProfile,
  type ProfileCatalog,
  type ProfileRoot,
} from "../services/profiles";
import ProfilesSettings from "./ProfilesSettings";

export interface ProfilesSectionProps {
  /** Runs the full dirty-safe controlled switch. Omit while the host has
   * no active-job/sensitive-lock guard: switching then fails closed. */
  switchTo?: (targetId: string) => Promise<boolean>;
  onOpenHelp: (slug: string) => void;
  onChoosePortableDestination?: () => Promise<string | null>;
  onRestartWithCopy?: () => Promise<void>;
  onOpenPortableCopy?: () => void;
}

export default function ProfilesSection({
  switchTo,
  onOpenHelp,
  onChoosePortableDestination,
  onRestartWithCopy,
  onOpenPortableCopy,
}: ProfilesSectionProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);
  const [root, setRoot] = useState<ProfileRoot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = async () => {
    const [nextCatalog, nextRoot] = await Promise.all([listProfiles(), getProfileRoot()]);
    if (!mounted.current) return;
    setCatalog(nextCatalog);
    setRoot(nextRoot);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await refresh();
    } catch (caught) {
      if (!mounted.current) return;
      setError(errorCode(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);

  /** A stale revision is reloaded before the message reaches the dialog, so
   * the next attempt uses the catalog the other window wrote. */
  const afterConflict = async (caught: unknown) => {
    if (errorCode(caught) === "profiles.changed") {
      await refresh().catch(() => undefined);
    }
    throw caught;
  };

  const create = async (name: string) => {
    if (catalog === null) return;
    try {
      const next = await createProfile(name, catalog.revision);
      if (mounted.current) setCatalog(next);
    } catch (caught) {
      await afterConflict(caught);
    }
  };

  const rename = async (id: string, name: string) => {
    if (catalog === null) return;
    try {
      const next = await renameProfile(id, name, catalog.revision);
      if (mounted.current) setCatalog(next);
    } catch (caught) {
      await afterConflict(caught);
    }
  };

  /** Fail closed: without the coordinator's dirty/job/lock/flush guard the
   * native pending id must never be written. The switch action is omitted,
   * which keeps it disabled in the list. */
  const switchProfile = switchTo
    ? async (id: string) => {
        await switchTo(id);
      }
    : undefined;

  if (loading) return <Skeleton variant="rows" count={3} />;
  if (catalog === null || root === null) {
    return (
      <div className="adp-settings-section">
        <p className="adp-note adp-note--error" role="alert">
          {errorText(t, error, "profiles")}
        </p>
        <Button onClick={() => void load()}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <ProfilesSettings
      catalog={catalog}
      root={root}
      onCreate={create}
      onRename={rename}
      onSwitch={switchProfile}
      onOpenHelp={onOpenHelp}
      onChoosePortableDestination={onChoosePortableDestination}
      onRestartWithCopy={onRestartWithCopy}
      onOpenPortableCopy={onOpenPortableCopy}
    />
  );
}
