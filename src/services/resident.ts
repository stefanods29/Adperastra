import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { formatSize } from "./format";

/** Mirrors Rust `ResidentState` (revision `resident-mode-1`). */
export type ResidentState =
  | "visible"
  | "closing_decision"
  | "resident"
  | "restoring"
  | "quitting";

/** Mirrors Rust `ResidentStatus`. */
export interface ResidentStatus {
  state: ResidentState;
  enabled: boolean;
  start_with_windows: boolean;
  /** Measured private bytes from PROCESS_MEMORY_COUNTERS_EX. */
  private_bytes: number;
  measured_unix: number;
  active_jobs: number;
}

/** The two startup choices added by settings schema 43. */
export interface ResidentStartupChoices {
  stay_in_background: boolean;
  start_with_windows: boolean;
}

export const RESIDENT_STARTUP_DEFAULTS: Readonly<ResidentStartupChoices> = Object.freeze({
  stay_in_background: false,
  start_with_windows: false,
});

export function defaultResidentStartup(): ResidentStartupChoices {
  return { ...RESIDENT_STARTUP_DEFAULTS };
}

const RESIDENT_STATES: readonly ResidentState[] = [
  "visible",
  "closing_decision",
  "resident",
  "restoring",
  "quitting",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Schema 43 repair: missing fields are off. Starting with Windows is only
 * meaningful while staying in the background is on.
 */
export function normalizeResidentStartup(value: unknown): ResidentStartupChoices {
  const input = isRecord(value) ? value : {};
  const stay = input.stay_in_background === true;
  return {
    stay_in_background: stay,
    start_with_windows: stay && input.start_with_windows === true,
  };
}

/**
 * Merge the two startup choices into an existing `startup` object without
 * dropping fields written by later steps (migration 42 -> 43).
 */
export function mergeResidentStartup<T extends object>(
  existing: T,
  startup: ResidentStartupChoices,
): T & ResidentStartupChoices {
  const base = isRecord(existing) ? { ...existing } : {};
  return { ...base, ...normalizeResidentStartup(startup) } as T & ResidentStartupChoices;
}

function safeUnsigned(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeResidentStatus(value: unknown): ResidentStatus {
  const input = isRecord(value) ? value : {};
  const state = RESIDENT_STATES.includes(input.state as ResidentState)
    ? (input.state as ResidentState)
    : "visible";
  return {
    state,
    enabled: input.enabled === true,
    start_with_windows: input.start_with_windows === true,
    private_bytes: safeUnsigned(input.private_bytes),
    measured_unix: safeUnsigned(input.measured_unix),
    active_jobs: Math.min(safeUnsigned(input.active_jobs), 4_294_967_295),
  };
}

/** The exact measured figure, formatted like every other size in the app. */
export function formatResidentMemory(privateBytes: number, locale: string): string {
  return formatSize(privateBytes, locale);
}

export interface ResidentPolicy {
  release_engines: boolean;
  keep_background_tasks: boolean;
}

/** While resident the shell releases engines; it never adds a task. */
export function residentPolicy(state: ResidentState): ResidentPolicy {
  return {
    release_engines: state === "resident",
    keep_background_tasks: true,
  };
}

export const TRAY_ID = "adperastra-tray";

export type TrayActionId = "resident.open" | "resident.turnOff" | "resident.quit";

export interface TrayAction {
  id: TrayActionId;
  requires_dirty_decision: boolean;
  /** No tray action ever exits without the normal dirty decision. */
  direct_exit: boolean;
}

export interface TrayItemModel extends TrayAction {
  label: string;
}

export interface TrayMenuModel {
  id: string;
  items: TrayItemModel[];
}

const TRAY_ACTIONS: readonly TrayAction[] = [
  { id: "resident.open", requires_dirty_decision: false, direct_exit: false },
  { id: "resident.turnOff", requires_dirty_decision: true, direct_exit: false },
  { id: "resident.quit", requires_dirty_decision: true, direct_exit: false },
];

export function trayAction(id: string): TrayAction | null {
  return TRAY_ACTIONS.find((action) => action.id === id) ?? null;
}

export function trayMenuModel(t: TFunction): TrayMenuModel {
  return {
    id: TRAY_ID,
    items: [
      { ...TRAY_ACTIONS[0], label: t("resident.open") },
      { ...TRAY_ACTIONS[1], label: t("resident.disable") },
      { ...TRAY_ACTIONS[2], label: t("resident.quit") },
    ],
  };
}

export interface TrayHandlers {
  showWindow: () => Promise<void>;
  turnOff: () => Promise<boolean>;
  quit: () => Promise<boolean>;
}

/**
 * Route one tray choice through the native dirty-safe coordinator. `quit`
 * and `turnOff` return false when the user cancelled the dirty decision; in
 * that case the window and every tab stay exactly as they were.
 */
export async function runTrayAction(
  id: string,
  handlers: TrayHandlers,
): Promise<"shown" | "cancelled" | "quit" | "ignored"> {
  const action = trayAction(id);
  if (!action) return "ignored";
  if (action.id === "resident.open") {
    await handlers.showWindow();
    return "shown";
  }
  const done =
    action.id === "resident.turnOff" ? await handlers.turnOff() : await handlers.quit();
  return done ? "quit" : "cancelled";
}

export interface TrayLabels {
  open: string;
  turn_off: string;
  quit: string;
}

export async function residentStatus(): Promise<ResidentStatus> {
  return normalizeResidentStatus(await invoke("resident_status"));
}

export async function setResidentMode(
  enabled: boolean,
  startWithWindows: boolean,
): Promise<ResidentStatus> {
  return normalizeResidentStatus(
    await invoke("resident_set", {
      enabled,
      startWithWindows: enabled && startWithWindows,
    }),
  );
}

export async function showResidentWindow(): Promise<void> {
  await invoke("resident_show");
}

export type ResidentCloseReason = "close" | "turn_off" | "quit";
export type ResidentCloseDecision = "keep_visible" | "hide" | "exit";

/**
 * Continue a close after the normal dirty flow approved it. Never call this
 * before the documents settled; a cancelled decision must not call it.
 */
export async function confirmResidentClose(
  reason: ResidentCloseReason,
): Promise<ResidentCloseDecision> {
  return (await invoke("resident_close_confirmed", {
    reason,
  })) as ResidentCloseDecision;
}

/** Replace the labels of the one existing tray menu after a language change. */
export async function setTrayLabels(labels: TrayLabels): Promise<void> {
  await invoke("resident_tray_labels", { labels });
}

