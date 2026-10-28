import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  const { t } = useTranslation();
  return (
    <div className="adp-search">
      <Search size={14} aria-hidden="true" className="adp-search-icon" />
      <input
        className="adp-search-input"
        type="search"
        value={value}
        placeholder={placeholder ?? t("common.search")}
        aria-label={placeholder ?? t("common.search")}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="adp-search-clear"
          aria-label={t("components.clearSearch")}
          title={t("components.clearSearch")}
          onClick={() => onChange("")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
