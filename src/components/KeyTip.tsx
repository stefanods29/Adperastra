export interface KeyTipProps {
  letter: string;
  visible?: boolean;
}

export default function KeyTip({ letter, visible = true }: KeyTipProps) {
  if (!visible) return null;
  return (
    <span className="adp-keytip" aria-hidden="true">
      {letter}
    </span>
  );
}
