import { useTranslation } from "react-i18next";
import { passwordStrength, passwordStrengthValue } from "./passwordStrength";

/** The informational strength meter: text plus a numeric value, never color
 * alone (Step 06e D9). */
export default function PasswordMeter({ value }: { value: string }) {
  const { t } = useTranslation();
  if (!value) return null;
  const strength = passwordStrength(value);
  const level = passwordStrengthValue(value);
  return (
    <div className="adp-password-strength">
      <div
        className="adp-password-meter"
        role="meter"
        aria-label={t("archive.passwordStrength")}
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={level}
      >
        <span className={`adp-password-meter-fill adp-password-meter-${strength}`} />
      </div>
      <span className="adp-password-strength-label">
        {t("archive.passwordStrength")}:{" "}
        {t(`archive.password${strength[0].toUpperCase()}${strength.slice(1)}`)}
      </span>
    </div>
  );
}
