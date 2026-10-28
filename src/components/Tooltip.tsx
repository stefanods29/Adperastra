import { useRef, useState, type ReactNode } from "react";

export interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
}

export default function Tooltip({ label, shortcut, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);

  const show = () => {
    timer.current = window.setTimeout(() => setVisible(true), 400);
  };
  const hide = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setVisible(false);
  };

  return (
    <span
      className="adp-tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible ? (
        <span className="adp-tooltip" role="tooltip">
          <span>{label}</span>
          {shortcut ? <span className="adp-tooltip-shortcut">{shortcut}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
