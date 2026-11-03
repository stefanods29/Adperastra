import SpecialImageView from "../specialImage/SpecialImageView";
import type { HandlerViewProps } from "../types";

/** Camera RAW tab (Step 07g D5). */
export default function RawView(props: HandlerViewProps) {
  return <SpecialImageView {...props} kind="raw" />;
}
