/**
 * Safe-mode entry points (Step 09h T4). E6 stays canonical in
 * `services/recovery.ts`; this module is the small import surface used by
 * the boot host and the persistent banner so neither reaches into recovery
 * internals.
 */
export {
  registerRestartGuard,
  restartNormally,
  safeModeStatus,
  type SafeModeReason,
  type SafeModeStatus,
} from "./recovery";
