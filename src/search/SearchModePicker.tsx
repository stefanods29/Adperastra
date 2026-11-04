import { Check, ChevronDown, CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SearchMode } from "../services/search";
import { SEARCH_MODE_CYCLE } from "./queryParsing";

export interface SearchModePickerProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  /** Translated setup reason shown for the disabled AI entries. */
  disabledReason: string;
  onOpenHelp: (slug: string) => void;
  disabled?: boolean;
}

export const DISABLED_MODES = ["ask", "photo", "similar"] as const;

const MODE_LABEL_KEYS: Record<SearchMode, string> = {
  name: "search.name",
  content: "search.content",
  filters: "search.filters",
  regex: "search.regex",
};

const DISABLED_LABEL_KEYS: Record<(typeof DISABLED_MODES)[number], string> = {
  ask: "search.ask",
  photo: "search.photo",
  similar: "search.similar",
};

/** Accessible mode button: aria-expanded, a selected option, arrow keys,
 * Escape, and disabled AI entries that explain their setup reason without
 * starting a search or a network request. */
export default function SearchModePicker({
  mode,
  onChange,
  disabledReason,
  onOpenHelp,
  disabled,
}: SearchModePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const options: Array<{ id: SearchMode | (typeof DISABLED_MODES)[number]; disabled: boolean }> = [
    ...SEARCH_MODE_CYCLE.map((id) => ({ id, disabled: false })),
    ...DISABLED_MODES.map((id) => ({ id, disabled: true })),
  ];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const choose = (id: SearchMode | (typeof DISABLED_MODES)[number], isDisabled: boolean) => {
    if (isDisabled) {
      setAnnounce(disabledReason);
      return;
    }
    onChange(id as SearchMode);
    setAnnounce("");
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
        setActive(SEARCH_MODE_CYCLE.indexOf(mode));
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.id, option.disabled);
    }
  };

  return (
    <div className="adp-search-mode" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="adp-search-mode__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t("search.mode")}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setActive(SEARCH_MODE_CYCLE.indexOf(mode));
        }}
      >
        <span>{t(MODE_LABEL_KEYS[mode])}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="adp-search-mode__popup">
          <ul
            id={listId}
            role="listbox"
            aria-label={t("search.mode")}
            aria-activedescendant={`${listId}-${active}`}
          >
            {options.map((option, index) => {
              const selected = option.id === mode;
              return (
                <li
                  key={option.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  title={option.disabled ? disabledReason : undefined}
                  className={[
                    "adp-search-mode__option",
                    selected ? "adp-search-mode__option--selected" : "",
                    option.disabled ? "adp-search-mode__option--disabled" : "",
                    active === index ? "adp-search-mode__option--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option.id, option.disabled);
                  }}
                >
                  <span>
                    {option.disabled
                      ? t(DISABLED_LABEL_KEYS[option.id as (typeof DISABLED_MODES)[number]])
                      : t(MODE_LABEL_KEYS[option.id as SearchMode])}
                  </span>
                  {selected ? <Check size={14} aria-hidden="true" /> : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="adp-search-mode__help"
            onClick={() => onOpenHelp("search-modes")}
          >
            <CircleHelp size={14} aria-hidden="true" />
            {t("search.help")}
          </button>
        </div>
      ) : null}
      {announce ? (
        <p className="adp-search-mode__status" role="status">
          {announce}
        </p>
      ) : null}
    </div>
  );
}
