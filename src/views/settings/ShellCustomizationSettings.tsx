/** Settings bodies for the Step 10e shell customization: menus, Home,
 * navigation, status and shareable setups. The editors own their drafts;
 * every Apply saves one validated `shell_custom` value through SettingsView,
 * and Cancel leaves the saved configuration untouched. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { CommandRegistry, type Command } from "../../commands/registry";
import { errorText } from "../../services/errors";
import { isoDate } from "../../services/settingsFile";
import { loadSettings, type AppSettings } from "../../services/settings";
import {
  SETUP_PARTS,
  applySetup,
  exportSetup,
  pickSetupImport,
  previewSetup,
  releaseSetupPreview,
  setupPartLabelKey,
  type SetupApplyRequest,
  type SetupApplyResult,
  type SetupPart,
  type SetupPreview,
} from "../../services/setups";
import { pickSavePath } from "../../services/textFiles";
import HomeEditor from "../../shell/HomeEditor";
import MenuEditor from "../../shell/MenuEditor";
import NavigationEditor from "../../shell/NavigationEditor";
import SetupImportDialog from "../../shell/SetupImportDialog";
import StatusEditor, { type StatusFieldChoice } from "../../shell/StatusEditor";
import { defaultMenuForTarget, menuTargetsInOrder } from "../../shell/menuCustomization";
import { homeSections, statusFields } from "../../shell/registries";
import type { MenuTarget, ShellCustomization, StatusKind } from "../../shell/types";

export interface ShellSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
  /** Live registered commands for the menu preview and its labels. */
  commands?: readonly Command[];
}

function applyShell(props: ShellSettingsProps, shell_custom: ShellCustomization): Promise<void> {
  props.onApply({ ...props.settings, shell_custom });
  return Promise.resolve();
}

/** File, folder and background menus: the tab/group defaults arrive with
 * their own hosts, so they stay out until those hosts pass their trees. */
export function MenuSettingsBody(props: ShellSettingsProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<MenuTarget>("file");
  const registry = useMemo(() => {
    const next = new CommandRegistry();
    for (const command of props.commands ?? []) {
      try {
        next.register(command);
      } catch {
        // A duplicate id in the aggregated palette list keeps the first one.
      }
    }
    return next;
  }, [props.commands]);
  const targets = useMemo(
    () =>
      menuTargetsInOrder()
        .filter((entry) => entry === "file" || entry === "folder" || entry === "background")
        .map((entry) => ({ target: entry, defaults: defaultMenuForTarget(entry) })),
    [],
  );
  const defaults = defaultMenuForTarget(target);
  return (
    <MenuEditor
      target={target}
      value={props.settings.shell_custom.menus}
      defaults={defaults}
      targets={targets}
      onTargetChange={setTarget}
      registry={registry}
      onApply={(menus) => applyShell(props, { ...props.settings.shell_custom, menus: [...menus] })}
      onCancel={() => undefined}
      onOpenHelp={(slug) => props.onOpenHelp(slug ?? "editing-menus")}
      labelFor={(key) => t(key)}
    />
  );
}

export function HomeSettingsBody(props: ShellSettingsProps) {
  return (
    <HomeEditor
      value={props.settings.shell_custom.home}
      providers={homeSections.list()}
      onApply={(home) => applyShell(props, { ...props.settings.shell_custom, home })}
      onCancel={() => undefined}
      onOpenHelp={(slug) => props.onOpenHelp(slug ?? "customizing-home-navigation-status")}
    />
  );
}

export function NavigationSettingsBody(props: ShellSettingsProps) {
  return (
    <NavigationEditor
      value={props.settings.shell_custom.navigation}
      onApply={(navigation) => applyShell(props, { ...props.settings.shell_custom, navigation })}
      onCancel={() => undefined}
      onOpenHelp={(slug) => props.onOpenHelp(slug ?? "customizing-home-navigation-status")}
    />
  );
}

export function StatusSettingsBody(props: ShellSettingsProps) {
  const fields = useMemo<Partial<Record<StatusKind, readonly StatusFieldChoice[]>>>(() => {
    const registered = statusFields.fields("explorer").map((field) => ({
      id: field.id,
      labelKey: field.label_key,
    }));
    return { explorer: registered };
  }, [props.settings.shell_custom.status]);
  return (
    <StatusEditor
      value={props.settings.shell_custom.status}
      fields={fields}
      onApply={(status) => applyShell(props, { ...props.settings.shell_custom, status })}
      onCancel={() => undefined}
      onOpenHelp={(slug) => props.onOpenHelp(slug ?? "customizing-home-navigation-status")}
    />
  );
}

/** Export selected safe parts, or preview an archive before applying it.
 * Personal paths are excluded unless the owner ticks the separate box. */
export function SetupsSettingsBody(props: ShellSettingsProps) {
  const { t } = useTranslation();
  const [parts, setParts] = useState<ReadonlySet<SetupPart>>(() => new Set(SETUP_PARTS));
  const [personal, setPersonal] = useState(false);
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [applyResult, setApplyResult] = useState<SetupApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const togglePart = (part: SetupPart) => {
    setParts((current) => {
      const next = new Set(current);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const destination = await pickSavePath(
        t("setups.export"),
        `setup-${isoDate(new Date())}.adperastra-setup`,
        t("setups.title"),
      );
      if (destination === null) return;
      const handle = await exportSetup(destination, [...parts], personal);
      const result = await handle.completion;
      setMessage(result.path);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const chosen = await pickSetupImport(t("setups.import"), t("setups.title"));
      if (chosen === null) return;
      const handle = await previewSetup(chosen);
      setPreview(await handle.completion);
      setApplyResult(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const applyNow = async (request: SetupApplyRequest) => {
    const handle = await applySetup(request);
    const result = await handle.completion;
    const next = await loadSettings();
    await releaseSetupPreview(request.preview_id).catch(() => undefined);
    setMessage(null);
    props.onApply(next);
    // Keep the dialog open when Apply could not write every selected part or
    // reported a warning, so the owner sees it; otherwise close as before.
    const keepOpen =
      result.warning_codes.length > 0 ||
      result.pending_recovery ||
      result.applied_parts.length < request.parts.length;
    setApplyResult(keepOpen ? result : null);
    if (!keepOpen) setPreview(null);
    // Undo is not recorded here yet: setup_apply_start returns only the
    // journal id, applied parts and warnings, so the setup-import history
    // adapter has no bounded before/after part state to record or restore.
  };

  const closePreview = () => {
    const current = preview;
    setPreview(null);
    setApplyResult(null);
    if (current) void releaseSetupPreview(current.preview_id).catch(() => undefined);
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-setups-settings-title">
      <div className="adp-settings-section-header">
        <h3 id="adp-setups-settings-title">{t("setups.title")}</h3>
      </div>
      <p className="adp-setting-label">{t("setups.contents")}</p>
      <ul className="adp-setup-import__parts">
        {SETUP_PARTS.map((part) => (
          <li key={part} className="adp-setup-import__part">
            <label className="adp-setup-import__check">
              <input type="checkbox" checked={parts.has(part)} onChange={() => togglePart(part)} disabled={busy} />
              <span>{t(setupPartLabelKey(part))}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className="adp-setup-import__check">
        <input type="checkbox" checked={personal} onChange={(event) => setPersonal(event.target.checked)} disabled={busy} />
        <span>{t("setups.personal")}</span>
      </label>
      <div className="adp-button-row">
        <Button disabled={busy || parts.size === 0} onClick={() => void exportNow()}>
          {t("setups.export")}
        </Button>
      </div>
      <div className="adp-button-row">
        <Button disabled={busy} onClick={() => void importNow()}>
          {t("setups.import")}
        </Button>
      </div>
      {message !== null ? <p className="adp-empty-note" role="status">{message}</p> : null}
      {error ? <p className="adp-setup-import__error">{errorText(t, error, "setup")}</p> : null}
      {preview ? (
        <SetupImportDialog
          preview={preview}
          result={applyResult}
          onApply={applyNow}
          onClose={closePreview}
          onOpenHelp={(slug) => props.onOpenHelp(slug ?? "shareable-setups")}
        />
      ) : null}
    </section>
  );
}
