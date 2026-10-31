import { Eye, EyeOff } from "lucide-react";
import { useId, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "../components/IconButton";
import TextInput from "../components/TextInput";
import { MAX_PASSWORD_CHARS } from "./passwordLimits";

/** The hidden-by-default password inputs (Step 06e D9). No form, no name and
 * no autocomplete value is ever stored by the browser. */
export interface PasswordFieldsProps {
  value: string;
  onValueChange: (value: string) => void;
  confirmation?: string;
  onConfirmationChange?: (value: string) => void;
  show: boolean;
  onShowChange: (show: boolean) => void;
  disabled?: boolean;
  hintId?: string;
  passwordRef?: RefObject<HTMLInputElement | null>;
}

export default function PasswordFields({
  value,
  onValueChange,
  confirmation,
  onConfirmationChange,
  show,
  onShowChange,
  disabled,
  hintId,
  passwordRef,
}: PasswordFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="adp-archive-password-fields">
      <label className="adp-field-label" htmlFor={`${id}-password`}>
        {t("archive.password")}
      </label>
      <div className="adp-field-row">
        <TextInput
          inputId={`${id}-password`}
          value={value}
          onChange={onValueChange}
          type={show ? "text" : "password"}
          ariaLabel={t("archive.password")}
          autoComplete="off"
          maxLength={MAX_PASSWORD_CHARS}
          inputRef={passwordRef}
          describedBy={hintId}
          disabled={disabled}
        />
        <IconButton
          icon={show ? EyeOff : Eye}
          labelKey={show ? "archive.hidePassword" : "archive.showPassword"}
          onClick={() => onShowChange(!show)}
          pressed={show}
          disabled={disabled}
        />
      </div>
      {confirmation !== undefined && onConfirmationChange ? (
        <>
          <label className="adp-field-label" htmlFor={`${id}-confirmation`}>
            {t("archive.confirmPassword")}
          </label>
          <TextInput
            inputId={`${id}-confirmation`}
            value={confirmation}
            onChange={onConfirmationChange}
            type={show ? "text" : "password"}
            ariaLabel={t("archive.confirmPassword")}
            autoComplete="off"
            maxLength={MAX_PASSWORD_CHARS}
            describedBy={hintId}
            disabled={disabled}
          />
        </>
      ) : null}
    </div>
  );
}
