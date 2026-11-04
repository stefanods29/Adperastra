import { useEffect, useRef } from "react";
import {
  recoveryCaptureRegistry,
  type RecoveryCaptureOptions,
  type RecoveryCaptureRegistry,
} from "./recoveryScheduler";
import type { DocumentHandle } from "./types";

/**
 * E3: lease one recovery capture owner for a view of `document`. Two views
 * of the same document share one owner and one schedule. Cleanup cancels a
 * pending debounce and releases the lease; it never discards the document.
 */
export function useRecoveryCapture(
  document: DocumentHandle,
  options: RecoveryCaptureOptions,
  onWarning: (code: string) => void,
  registry: RecoveryCaptureRegistry = recoveryCaptureRegistry,
): void {
  const warningRef = useRef(onWarning);
  warningRef.current = onWarning;
  const enabled = options.enabled;
  const interval = options.interval_seconds;
  useEffect(() => {
    if (!enabled) return;
    return registry.acquire(document, { enabled, interval_seconds: interval }, (code) => {
      warningRef.current(code);
    });
  }, [registry, document, enabled, interval]);
}
