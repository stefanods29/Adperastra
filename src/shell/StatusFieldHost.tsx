/** Status bar fields (Step 10e T4, E3).
 *
 * The host reads only the visible ids from the owning view's registry, so a
 * hidden free-space field never asks a drive for anything. Critical save,
 * error and progress messages are rendered even when the bar is hidden; the
 * legacy file-tab items and zoom stay available until an editor registers
 * explicit fields (D6).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatSizeWithOptions, type FormatOptions } from "../services/displayFormats";
import type { StatusFieldRegistry } from "./registries";
import type { StatusFieldOrderEntry, StatusValue } from "./types";

export interface StatusFieldHostProps {
  registry: StatusFieldRegistry;
  ownerId: string;
  order: readonly StatusFieldOrderEntry[];
  visible: boolean;
  /** Save, error and progress messages: never hidden with the bar. */
  critical?: ReactNode;
  /** Legacy FileTabStatus.items until an editor registers explicit fields. */
  legacyItems?: readonly string[];
  zoom?: { percent: number };
  /** Current 10c display options; omitted keeps the legacy size format. */
  formatOptions?: FormatOptions;
  className?: string;
}

interface FieldValue {
  id: string;
  label_key: string;
  value: StatusValue;
}

function valueText(value: StatusValue, locale: string, formatOptions?: FormatOptions): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return new Intl.NumberFormat(locale).format(value.value);
    case "size":
      return formatSizeWithOptions(value.bytes, locale, formatOptions);
    case "position":
      return `${value.line}:${value.column}`;
    case "zoom":
      return `${value.percent}%`;
  }
}

export default function StatusFieldHost(props: StatusFieldHostProps) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<readonly FieldValue[]>([]);
  // JSON keeps ids that contain ":" or "|" intact; a delimiter join did not.
  const orderKey = JSON.stringify(props.order);

  useEffect(() => {
    if (!props.visible) {
      setValues([]);
      return;
    }
    const ids = (JSON.parse(orderKey) as readonly StatusFieldOrderEntry[])
      .filter((entry) => entry.visible)
      .map((entry) => entry.id);
    let disposed = false;
    const read = () => {
      if (disposed) return;
      setValues([...props.registry.read(props.ownerId, ids)]);
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [props.registry, props.ownerId, orderKey, props.visible]);

  if (!props.visible) {
    return props.critical ? (
      <div className={`adp-statusbar adp-status-fields adp-status-fields--critical${props.className ? ` ${props.className}` : ""}`}>
        {props.critical}
      </div>
    ) : null;
  }

  return (
    <div className={`adp-statusbar adp-status-fields${props.className ? ` ${props.className}` : ""}`} role="status">
      {values.map((field) => {
        const label = t(field.label_key);
        const text = valueText(field.value, i18n.language, props.formatOptions);
        return (
          <span key={field.id} className="adp-status-field adp-status-text" title={label} aria-label={`${label}: ${text}`}>
            {text}
          </span>
        );
      })}
      {props.legacyItems?.map((text, index) => (
        <span key={`legacy-${index}`} className="adp-status-text">
          {text}
        </span>
      ))}
      {props.zoom ? <span className="adp-status-text">{props.zoom.percent}%</span> : null}
      {props.critical}
    </div>
  );
}
