export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  type?: string;
  disabled?: boolean;
}

export default function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = "text",
  disabled,
}: TextInputProps) {
  return (
    <input
      className="adp-input"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
