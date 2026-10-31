import { useCallback, useRef, useState, type ReactNode } from "react";
import type { SaveHandle } from "../handlers/types";
import type { TabState } from "../services/tabs";
import UnsavedDialog from "./UnsavedDialog";

/** Unsaved changes across file tabs (Step 06a): the dots, the questions,
 * the saves. */

interface Question {
  ids: string[];
  names: string[];
  resolve: (proceed: boolean) => void;
}

export interface UnsavedChanges {
  /** File tabs with unsaved changes. */
  dirtyIds: Set<string>;
  onDirtyChange: (id: string, dirty: boolean) => void;
  registerSave: (id: string, handle: SaveHandle | null) => void;
  /** True when every dirty tab among `ids` was saved or set aside. */
  confirmClose: (ids: readonly string[]) => Promise<boolean>;
  /** The question while one is open, else null. */
  dialog: ReactNode;
}

export function useUnsavedChanges(tabs: readonly TabState[]): UnsavedChanges {
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [question, setQuestion] = useState<Question | null>(null);
  const handles = useRef(new Map<string, SaveHandle>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const dirtyRef = useRef(dirtyIds);
  dirtyRef.current = dirtyIds;

  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const registerSave = useCallback((id: string, handle: SaveHandle | null) => {
    if (handle) handles.current.set(id, handle);
    else handles.current.delete(id);
  }, []);

  const confirmClose = useCallback((ids: readonly string[]): Promise<boolean> => {
    const dirty = ids.filter((id) => dirtyRef.current.has(id));
    if (dirty.length === 0) return Promise.resolve(true);
    const names = dirty.map((id) => tabsRef.current.find((tab) => tab.id === id)?.title ?? "");
    return new Promise<boolean>((resolve) => {
      setQuestion({ ids: dirty, names, resolve });
    });
  }, []);

  const answer = async (choice: "save" | "discard" | "cancel"): Promise<void> => {
    const current = question;
    if (!current) return;
    setQuestion(null);
    if (choice === "cancel") {
      current.resolve(false);
      return;
    }
    if (choice === "discard") {
      for (const id of current.ids) handles.current.get(id)?.discard();
      current.resolve(true);
      return;
    }
    for (const id of current.ids) {
      const handle = handles.current.get(id);
      if (!handle) {
        current.resolve(false);
        return;
      }
      const saved = await handle.save();
      if (!saved) {
        current.resolve(false);
        return;
      }
    }
    current.resolve(true);
  };

  const dialog = question ? (
    <UnsavedDialog
      names={question.names}
      onSave={() => void answer("save")}
      onDontSave={() => void answer("discard")}
      onCancel={() => void answer("cancel")}
    />
  ) : null;

  return { dirtyIds, onDirtyChange, registerSave, confirmClose, dialog };
}
