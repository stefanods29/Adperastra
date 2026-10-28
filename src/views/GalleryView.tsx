import { FileText, Folder, Home, LayoutGrid, Save, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import DropdownMenu from "../components/DropdownMenu";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import KeyTip from "../components/KeyTip";
import ListRow from "../components/ListRow";
import NavItem from "../components/NavItem";
import ProgressBar from "../components/ProgressBar";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import Slider from "../components/Slider";
import SplitButton from "../components/SplitButton";
import Switch from "../components/Switch";
import TextInput from "../components/TextInput";
import ToastStack, { type ToastData } from "../components/Toast";
import Tooltip from "../components/Tooltip";

export interface GalleryViewProps {
  onOpenHelp: () => void;
}

const CRUMB_SEGMENTS = [
  { id: "home", label: "Home" },
  { id: "documents", label: "Documents" },
  { id: "reports", label: "Reports" },
];

export default function GalleryView({ onOpenHelp }: GalleryViewProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [slider, setSlider] = useState(40);
  const [altHeld, setAltHeld] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [status, setStatus] = useState("");
  const [selectedRow, setSelectedRow] = useState("a");

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const options = [
    { id: "one", label: t("gallery.optionOne") },
    { id: "two", label: t("gallery.optionTwo") },
    { id: "three", label: t("gallery.optionThree") },
  ];
  const showToast = () =>
    setToasts((current) => [
      ...current,
      { id: Date.now(), message: t("toast.sampleUndo"), showUndo: true, shortcutHint: "Ctrl+Z" },
    ]);
  const dismiss = (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id));
  const undo = (id: number) => {
    dismiss(id);
    setStatus(t("gallery.toastUndone"));
  };

  return (
    <div className="adp-gallery">
      <div className="adp-view-header">
        <h2 className="adp-heading">{t("gallery.title")}</h2>
        <span className="adp-badge">{t("gallery.devBadge")}</span>
        <HelpButton onOpenHelp={onOpenHelp} />
      </div>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.buttons")}</h3>
        <div className="adp-gallery-row">
          <Button variant="primary">{t("gallery.primaryAction")}</Button>
          <Button>{t("gallery.defaultAction")}</Button>
          <Button variant="subtle">{t("gallery.subtleAction")}</Button>
          <Button disabled>{t("gallery.defaultAction")}</Button>
          <SplitButton label={t("gallery.splitAction")} items={options} onSelect={() => undefined} />
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.iconButtons")}</h3>
        <div className="adp-gallery-row">
          <IconButton icon={Save} labelKey="common.save" />
          <IconButton icon={Settings} labelKey="settings.title" />
          <IconButton icon={Save} labelKey="common.save" disabled />
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.inputs")}</h3>
        <div className="adp-gallery-row">
          <TextInput value={text} onChange={setText} placeholder={t("gallery.samplePlaceholder")} ariaLabel={t("gallery.samplePlaceholder")} />
          <SearchBox value={search} onChange={setSearch} />
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.breadcrumb")}</h3>
        <Breadcrumb segments={CRUMB_SEGMENTS} onNavigate={() => undefined} />
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.listRows")}</h3>
        <div>
          <ListRow icon={Folder} name="Documents" meta="128 items" selected={selectedRow === "a"} onClick={() => setSelectedRow("a")} />
          <ListRow icon={FileText} name="Notes.txt" meta="12 KB" selected={selectedRow === "b"} onClick={() => setSelectedRow("b")} />
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.navItems")}</h3>
        <div>
          <NavItem icon={Home} label={t("explorer.nav.home")} active pinned />
          <NavItem icon={LayoutGrid} label={t("explorer.nav.gallery")} />
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.menuDemo")}</h3>
        <div className="adp-gallery-row">
          <DropdownMenu label={t("gallery.openMenu")} ariaLabel={t("gallery.openMenu")} items={options} onSelect={() => undefined} />
          <DropdownMenu label={t("gallery.dropdownLabel")} ariaLabel={t("gallery.dropdownLabel")} items={options} onSelect={() => undefined} />
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.dialogDemo")}</h3>
        <div className="adp-gallery-row">
          <Button onClick={() => setDialogOpen(true)}>{t("gallery.openDialog")}</Button>
        </div>
        {dialogOpen ? (
          <Dialog title={t("gallery.dialogDemo")} onClose={() => setDialogOpen(false)}>
            <p>{t("gallery.dialogBody")}</p>
            <Button onClick={() => setDialogOpen(false)}>{t("common.close")}</Button>
          </Dialog>
        ) : null}
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.tooltipDemo")}</h3>
        <div className="adp-gallery-row">
          <Tooltip label={t("gallery.tooltipText")} shortcut="Ctrl+S">
            <Button>{t("common.save")}</Button>
          </Tooltip>
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.keyTipsDemo")}</h3>
        <p className="adp-note">{t("gallery.keyTipsHint")}</p>
        <div className="adp-gallery-row">
          <Button variant="primary">
            {t("common.save")}
            <KeyTip letter="S" visible={altHeld} />
          </Button>
          <Button>
            {t("common.open")}
            <KeyTip letter="O" visible={altHeld} />
          </Button>
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.toastDemo")}</h3>
        <div className="adp-gallery-row">
          <Button onClick={showToast}>{t("gallery.showToast")}</Button>
          {status ? <span className="adp-status-text">{status}</span> : null}
        </div>
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.skeletons")}</h3>
        <Skeleton variant="rows" count={3} />
        <Skeleton variant="tiles" count={3} />
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.progress")}</h3>
        <ProgressBar value={40} />
        <ProgressBar value={75} />
        <ProgressBar />
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.switches")}</h3>
        <Switch checked={enabled} onChange={setEnabled} label={t("gallery.featureToggle")} />
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.sliders")}</h3>
        <Slider value={slider} min={0} max={100} onChange={setSlider} label={t("gallery.sliderLabel")} />
      </section>

      <section className="adp-gallery-section">
        <h3 className="adp-subheading">{t("gallery.dropdownDemo")}</h3>
        <DropdownMenu label={t("gallery.dropdownLabel")} ariaLabel={t("gallery.dropdownLabel")} items={options} onSelect={() => undefined} />
      </section>

      <ToastStack toasts={toasts} onDismiss={dismiss} onUndo={undo} />
    </div>
  );
}
