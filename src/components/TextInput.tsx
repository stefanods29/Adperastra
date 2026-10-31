import type { RefObject } from "react";

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  type?: string;
  disabled?: boolean;
  /** "off" or "new-password": never a stored credential. */
  autoComplete?: string;
  maxLength?: number;
  /** The caller focuses and measures the real input. */
  inputRef?: RefObject<HTMLInputElement | null>;
  describedBy?: string;
  invalid?: boolean;
  inputId?: string;
}

export default function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = "text",
  disabled,
  autoComplete,
  maxLength,
  inputRef,
  describedBy,
  invalid,
  inputId,
}: TextInputProps) {
  return (
    <input
      id={inputId}
      ref={inputRef}
      className="adp-input"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      autoComplete={autoComplete}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
