import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import TextInput from "../components/TextInput";
import { errorText } from "../services/errors";
import { formatDate } from "../services/format";
import type { SavedGroupCatalog, SavedTabGroup } from "../services/savedGroups";

/** The saved-groups catalog (Step 09b T5, E8): name, tab count and
 * modified date per row, virtualized past 20 rows at 36px each. Enter
 * opens the selected group; every action is awaited, and the panel
 * leaves its editing/confirming state only after success, so a failed
 * write keeps the catalog open with its error visible. */

export interface SavedGroupsPanelProps {
  catalog: SavedGroupCatalog | null;
  loading: boolean;
  errorCode?: string;
  onOpen: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onImport: () => Promise<void>;
  onExport: (ids: readonly string[]) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

const ROW_HEIGHT = 36;
const VIRTUALIZE_AFTER = 20;

export default function SavedGroupsPanel({
  catalog,
  loading,
  errorCode,
  onOpen,
  onRename,
  onRemove,
  onImport,
  onExport,
  onOpenHelp,
}: SavedGroupsPanelProps) {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [exportIds, setExportIds] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const groups = catalog?.groups ?? [];
  const virtual = groups.length > VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: virtual ? groups.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const fail = (error: unknown) => {
    setLocalError(errorText(t, error, "groups"));
  };

  const openSelected = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await onOpen(id);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await onImport();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const commitRename = async (group: SavedTabGroup) => {
    const name = draftName.trim();
    if ([...name].length < 1 || [...name].length > 60) {
      setLocalError(t("errors.groups.invalid"));
      return;
    }
    setBusy(true);
    try {
      await onRename(group.id, name);
      setEditingId(null);
      setLocalError("");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const commitRemove = async (group: SavedTabGroup) => {
    setBusy(true);
    try {
      await onRemove(group.id);
      setConfirmingId(null);
      setLocalError("");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleExport = (id: string, checked: boolean) => {
    setExportIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [
      ...(event.currentTarget.querySelectorAll<HTMLElement>("[data-saved-group-row]")),
    ];
    const currentIndex = rows.indexOf(document.activeElement as HTMLElement);
    const focusedRowId = (event.target as HTMLElement)
      .closest<HTMLElement>("[data-saved-group-row]")
      ?.getAttribute("data-saved-group-row");
    if (event.key === "Enter" && (focusedRowId ?? selectedId) !== null) {
      event.preventDefault();
      void openSelected(focusedRowId ?? (selectedId as string));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      rows[Math.min(rows.length - 1, currentIndex + 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      rows[Math.max(0, currentIndex - 1)]?.focus();
    }
  };

  const renderRow = (group: SavedTabGroup, style?: CSSProperties) => {
    const selected = selectedId === group.id;
    return (
      <div
        key={group.id}
        data-saved-group-row={group.id}
        role="option"
        aria-selected={selected}
        tabIndex={selected || (selectedId === null && groups[0]?.id === group.id) ? 0 : -1}
        className={`adp-saved-group-row${selected ? " adp-saved-group-row--selected" : ""}`}
        style={style}
        onFocus={() => setSelectedId(group.id)}
        onClick={() => {
          setSelectedId(group.id);
          void openSelected(group.id);
        }}
      >
        <span className="adp-saved-group-dot" data-color={group.color} aria-hidden="true" />
        {editingId === group.id ? (
          <span className="adp-saved-group-edit" onClick={(event) => event.stopPropagation()}>
            <TextInput
              value={draftName}
              onChange={setDraftName}
              ariaLabel={t("groups.name")}
              maxLength={60}
            />
            <Button
              disabled={busy}
              onClick={() => void commitRename(group)}
            >
              {t("common.save")}
            </Button>
            <Button disabled={busy} onClick={() => setEditingId(null)}>
              {t("common.cancel")}
            </Button>
          </span>
        ) : (
          <>
            <span className="adp-saved-group-name">{group.name}</span>
            <span className="adp-saved-group-meta">
              {t("groups.count", { count: group.tabs.length })}
            </span>
            <span className="adp-saved-group-meta">
              {formatDate(group.modified_unix, i18n.language)}
            </span>
            <input
              type="checkbox"
              className="adp-saved-group-check"
              aria-label={`${t("groups.export")} ${group.name}`}
              checked={exportIds.has(group.id)}
              disabled={busy}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => toggleExport(group.id, event.target.checked)}
            />
            <Button
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                setEditingId(group.id);
                setDraftName(group.name);
                setConfirmingId(null);
              }}
            >
              {t("groups.rename")}
            </Button>
            <Button
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingId(group.id);
                setEditingId(null);
              }}
            >
              {t("groups.removeSaved")}
            </Button>
          </>
        )}
        {confirmingId === group.id ? (
          <span className="adp-saved-group-confirm" role="alert" onClick={(event) => event.stopPropagation()}>
            <span>{t("groups.confirmRemove", { name: group.name })}</span>
            <Button disabled={busy} onClick={() => void commitRemove(group)}>
              {t("groups.removeSaved")}
            </Button>
            <Button disabled={busy} onClick={() => setConfirmingId(null)}>
              {t("common.cancel")}
            </Button>
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <section className="adp-saved-groups" aria-label={t("groups.saved")}>
      <div className="adp-saved-groups-header">
        <h2 className="adp-saved-groups-title">{t("groups.saved")}</h2>
        <HelpButton onOpenHelp={() => onOpenHelp("saved-tab-groups")} />
        <Button
          disabled={busy}
          onClick={() => void runImport()}
        >
          {t("groups.import")}
        </Button>
      </div>
      {errorCode ? (
        <p role="alert" className="adp-saved-groups-error">
          {errorText(t, errorCode, "groups")}
        </p>
      ) : null}
      {localError ? (
        <p role="alert" className="adp-saved-groups-error">
          {localError}
        </p>
      ) : null}
      {loading ? (
        <Skeleton variant="rows" count={3} />
      ) : groups.length === 0 ? (
        <p className="adp-saved-groups-empty">{t("groups.empty")}</p>
      ) : virtual ? (
        <div
          ref={parentRef}
          className="adp-saved-groups-list adp-saved-groups-list--virtual"
          role="listbox"
          aria-label={t("groups.saved")}
          onKeyDown={onListKeyDown}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) =>
              renderRow(groups[item.index], {
                position: "absolute",
                left: 0,
                right: 0,
                top: item.start,
                height: ROW_HEIGHT,
              }),
            )}
          </div>
        </div>
      ) : (
        <div
          className="adp-saved-groups-list"
          role="listbox"
          aria-label={t("groups.saved")}
          onKeyDown={onListKeyDown}
        >
          {groups.map((group) => renderRow(group))}
        </div>
      )}
      <div className="adp-saved-groups-footer">
        <Button
          disabled={busy || exportIds.size === 0}
          onClick={() => {
            setLocalError("");
            void onExport([...exportIds]).catch(fail);
          }}
        >
          {t("groups.exportSelected")}
        </Button>
      </div>
    </section>
  );
}
