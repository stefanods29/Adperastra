import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExplorerItem } from "../../services/explorer";
import { cleanTypedName, displayName, nameProblem, nameSelectionEnd, splitExtension } from "../../services/names";

export interface RenameInputProps {
  item: ExplorerItem;
  showExtensions: boolean;
  /** Resolves to a translated error message, or null when renamed. */
  onCommit(newName: string): Promise<string | null>;
  onCancel: () => void;
}

/** Inline rename box: only the name part starts selected (not the
 * extension), problems show while typing, Enter or clicking away saves,
 * Escape cancels. */
export default function RenameInput({ item, showExtensions, onCommit, onCancel }: RenameInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = displayName(item.name, item.kind, showExtensions);
  const [value, setValue] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const done = useRef(false);
  // System files get a warning first; renaming one needs a second Enter.
  const systemWarned = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(0, showExtensions ? nameSelectionEnd(item.name, item.kind) : shown.length);
    // Only when renaming starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = async () => {
    if (busy.current || done.current) return;
    const cleaned = cleanTypedName(value);
    const problem = nameProblem(cleaned);
    if (problem) {
      setError(t(`explorer.rename.problem.${problem}`));
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    // With extensions hidden, Windows keeps the original extension.
    const newName = showExtensions ? cleaned : cleaned + splitExtension(item.name, item.kind).extension;
    if (newName === item.name) {
      done.current = true;
      onCancel();
      return;
    }
    if (item.system && !systemWarned.current) {
      systemWarned.current = true;
      setError(t("explorer.rename.systemWarning"));
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    busy.current = true;
    const failure = await onCommit(newName);
    busy.current = false;
    if (failure) {
      setError(failure);
      inputRef.current?.focus({ preventScroll: true });
    } else {
      done.current = true;
    }
  };

  return (
    <span className="adp-rename" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <input
        ref={inputRef}
        className="adp-rename-input"
        aria-label={t("explorer.rename.label")}
        aria-invalid={error !== null}
        value={value}
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          const problem = nameProblem(event.target.value);
          setError(problem && problem !== "empty" ? t(`explorer.rename.problem.${problem}`) : null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          // A system file is renamed only with Enter, after the warning.
          if (item.system) {
            if (!done.current) {
              done.current = true;
              onCancel();
            }
            return;
          }
          void commit();
        }}
      />
      {error ? (
        <span className="adp-rename-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
