import { CircleHelp } from "lucide-react";
import IconButton from "./IconButton";

export interface HelpButtonProps {
  onOpenHelp: () => void;
}

export default function HelpButton({ onOpenHelp }: HelpButtonProps) {
  return <IconButton icon={CircleHelp} labelKey="help.title" onClick={onOpenHelp} />;
}
