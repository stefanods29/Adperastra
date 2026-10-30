import { ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "../../components/IconButton";
import SearchBox from "../../components/SearchBox";
import {
  startListDir,
  type ExplorerItem,
  type PathSegment,
} from "../../services/explorer";
import type { Command } from "../../commands/registry";

export interface AddressBarProps {
  backCommand: Command;
  forwardCommand: Command;
  upCommand: Command;
  refreshCommand: Command;
  commandCtx: Parameters<Command["enabledWhen"]>[0];
  onRun: (command: Command, arg?: string) => void;
  onNavigatePath: (path: string) => void;
  segments: PathSegment[];
  /** sibling roots used when the root segment's chevron is opened. */
  rootSiblings: { label: string; path: string }[];
  editablePath: string | null;
  placeLabel: string;
  historyEntries: { label: string; distance: number }[];
  onHistory: (distance: number) => void;
  search: string;
  onSearch: (value: string) => void;
}

export default function AddressBar(props: AddressBarProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [openSegment, setOpenSegment] = useState<number | null>(null);
  const [siblings, setSiblings] = useState<ExplorerItem[]>([]);
  const [siblingsLoading, setSiblingsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isAddressShortcut =
        ((event.ctrlKey || event.metaKey) && (event.key === "l" || event.key === "L")) ||
        (event.altKey && (event.key === "d" || event.key === "D"));
      if (!isAddressShortcut || props.editablePath === null) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && target !== inputRef.current))) return;
      event.preventDefault();
      setDraft(props.editablePath);
      setEditing(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.editablePath]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    if (props.editablePath === null) return;
    setDraft(props.editablePath);
    setEditing(true);
  };

  const openSiblings = async (index: number) => {
    if (openSegment === index) {
      setOpenSegment(null);
      return;
    }
    setOpenSegment(index);
    if (index === 0) {
      setSiblings([]);
      return;
    }
    const parent = props.segments[index - 1].path;
    setSiblingsLoading(true);
    try {
      const collected: ExplorerItem[] = [];
      const handle = await startListDir(parent, { key: "name", direction: "ascending" }, (batch) => collected.push(...batch));
      await handle.completion;
      setSiblings(collected.filter((item) => item.kind === "folder"));
    } catch {
      setSiblings([]);
    } finally {
      setSiblingsLoading(false);
    }
  };

  return (
    <div className="adp-addressbar">
      <div className="adp-nav-buttons">
        <IconButton icon={props.backCommand.icon} labelKey={props.backCommand.labelKey} shortcut={props.backCommand.shortcut} disabled={!props.backCommand.enabledWhen(props.commandCtx)} onClick={() => props.onRun(props.backCommand)} />
        <IconButton icon={props.forwardCommand.icon} labelKey={props.forwardCommand.labelKey} shortcut={props.forwardCommand.shortcut} disabled={!props.forwardCommand.enabledWhen(props.commandCtx)} onClick={() => props.onRun(props.forwardCommand)} />
        <div className="adp-dropdown">
          <button type="button" className="adp-icon-btn" aria-label={t("explorer.history")} title={t("explorer.history")} disabled={props.historyEntries.length === 0} onClick={() => setOpenSegment(openSegment === -1 ? null : -1)}>
            <Clock3 size={14} aria-hidden="true" />
          </button>
          {openSegment === -1 ? (
            <ul className="adp-menu" role="menu">
              {props.historyEntries.map((entry) => (
                <li key={entry.distance} role="none">
                  <button type="button" role="menuitem" className="adp-menu-item" onClick={() => { setOpenSegment(null); props.onHistory(entry.distance); }}>
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <IconButton icon={props.upCommand.icon} labelKey={props.upCommand.labelKey} shortcut={props.upCommand.shortcut} disabled={!props.upCommand.enabledWhen(props.commandCtx)} onClick={() => props.onRun(props.upCommand)} />
        <IconButton icon={props.refreshCommand.icon} labelKey={props.refreshCommand.labelKey} shortcut={props.refreshCommand.shortcut} disabled={!props.refreshCommand.enabledWhen(props.commandCtx)} onClick={() => props.onRun(props.refreshCommand)} />
      </div>

      {editing ? (
        <form
          className="adp-address-edit"
          onSubmit={(event) => {
            event.preventDefault();
            setEditing(false);
            if (draft.trim()) props.onNavigatePath(draft.trim());
          }}
        >
          <input
            ref={inputRef}
            className="adp-input adp-address-input"
            value={draft}
            aria-label={t("explorer.addressLabel")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
            onBlur={() => setEditing(false)}
          />
        </form>
      ) : (
        <nav
          className="adp-breadcrumb adp-address-box"
          aria-label={t("components.breadcrumb")}
          onClick={(event) => {
            if (event.target === event.currentTarget) startEditing();
          }}
        >
          {props.segments.map((segment, index) => (
            <Fragment key={segment.path}>
              {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
              <span className="adp-breadcrumb-wrap">
                <button
                  type="button"
                  className="adp-breadcrumb-item"
                  aria-current={index === props.segments.length - 1 ? "page" : undefined}
                  onClick={() => props.onNavigatePath(segment.path)}
                  data-drop-folder={segment.path}
                  data-drop-name={segment.label}
                >
                  {segment.label}
                </button>
                <button
                  type="button"
                  className="adp-breadcrumb-chevron"
                  aria-label={t("explorer.siblingFolders", { name: segment.label })}
                  aria-expanded={openSegment === index}
                  onClick={() => void openSiblings(index)}
                >
                  <ChevronDown size={11} aria-hidden="true" />
                </button>
                {openSegment === index ? (
                  <ul className="adp-menu adp-breadcrumb-menu" role="menu">
                    {(index === 0 ? props.rootSiblings.map((s) => ({ path: s.path, name: s.label })) : siblings).map((item) => (
                      <li key={item.path} role="none">
                        <button type="button" role="menuitem" className="adp-menu-item" onClick={() => { setOpenSegment(null); props.onNavigatePath(item.path); }}>
                          {item.name}
                        </button>
                      </li>
                    ))}
                    {index !== 0 && siblingsLoading ? (
                      <li className="adp-menu-status">{t("components.loading")}</li>
                    ) : null}
                  </ul>
                ) : null}
              </span>
            </Fragment>
          ))}
          <span className="adp-address-spacer" onClick={startEditing} />
        </nav>
      )}

      <div className="adp-address-search">
        <SearchBox value={props.search} onChange={props.onSearch} placeholder={t("explorer.searchIn", { name: props.placeLabel })} />
      </div>
    </div>
  );
}