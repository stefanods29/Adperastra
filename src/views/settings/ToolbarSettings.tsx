/** Settings > Customize toolbars (Step 10b E5, D4). The editor owns its
 * draft; Cancel remounts it from the saved settings and a failed Apply
 * keeps the draft on screen. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import ToolbarCustomizer from "../../layout/ToolbarCustomizer";
import type { ToolbarCustomSettings, ToolbarDescriptor } from "../../services/commandLayout";

export interface ToolbarSettingsProps {
  descriptors: readonly ToolbarDescriptor[];
  value: ToolbarCustomSettings;
  labels?: Readonly<Record<string, string>>;
  onApply: (value: ToolbarCustomSettings) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

const HELP_SLUG = "customizing-toolbars";

export default function ToolbarSettings({ descriptors, value, labels, onApply, onOpenHelp }: ToolbarSettingsProps) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const openHelp = () => onOpenHelp(HELP_SLUG);

  return (
    <section className="adp-settings-section" aria-labelledby="adp-toolbars-title">
      <div className="adp-settings-section-header">
        <h3 id="adp-toolbars-title">{t("toolbarCustom.title")}</h3>
        <HelpButton onOpenHelp={openHelp} />
      </div>
      <ToolbarCustomizer
        key={revision}
        descriptors={descriptors}
        value={value}
        labels={labels}
        onApply={onApply}
        onCancel={() => setRevision((current) => current + 1)}
        onOpenHelp={openHelp}
      />
    </section>
  );
}
