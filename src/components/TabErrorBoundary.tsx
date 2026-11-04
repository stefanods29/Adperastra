import { AlertTriangle, RotateCw, X } from "lucide-react";
import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Button from "./Button";

/**
 * Keeps one failed file or folder view from taking the Explorer down. The
 * boundary wraps only the content view; the tab strip, Explorer root and
 * every other tab stay outside it. Nothing from the document is logged: only
 * a stable component code and a path-masked component stack, capped at 16 KiB.
 */

export interface TabErrorBoundaryProps {
  children: ReactNode;
  onReload: () => void;
  onClose: () => void;
}

interface BoundaryState {
  failed: boolean;
  code: string;
  stack: string;
}

const STACK_LIMIT = 16_384;

export function sanitizeFailure(error: unknown, info?: ErrorInfo): { code: string; stack: string } {
  const code = error instanceof Error && error.name ? error.name.slice(0, 64) : "view.failed";
  const stack = (info?.componentStack ?? "")
    .replace(/[A-Za-z]:\\[^\n]*/g, "<path>")
    .slice(0, STACK_LIMIT);
  return { code, stack };
}

function TabFailure({ code, onReload, onClose }: { code: string; onReload: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div
      ref={panel}
      className="adp-recovery-tab-error"
      role="alert"
      tabIndex={-1}
      aria-label={t("recovery.tabFailed")}
    >
      <AlertTriangle size={24} aria-hidden="true" className="adp-recovery-tab-icon" />
      <p className="adp-recovery-tab-message">{t("recovery.tabFailed")}</p>
      <p className="adp-recovery-tab-code" aria-hidden="true">
        {code}
      </p>
      <div className="adp-recovery-tab-actions">
        <Button variant="primary" onClick={onReload}>
          <RotateCw size={16} aria-hidden="true" />
          {t("recovery.reload")}
        </Button>
        <Button onClick={onClose}>
          <X size={16} aria-hidden="true" />
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

export default class TabErrorBoundary extends Component<TabErrorBoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, code: "view.failed", stack: "" };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    const { code, stack } = sanitizeFailure(error);
    return { failed: true, code, stack };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const { code, stack } = sanitizeFailure(error, info);
    // Do not log the error message: it may contain file text.
    console.error("adperastra.view.failed", code, stack);
  }

  private reload = (): void => {
    this.setState({ failed: false, code: "view.failed", stack: "" });
    this.props.onReload();
  };

  render(): ReactNode {
    if (this.state.failed) {
      return <TabFailure code={this.state.code} onReload={this.reload} onClose={this.props.onClose} />;
    }
    return this.props.children;
  }
}
