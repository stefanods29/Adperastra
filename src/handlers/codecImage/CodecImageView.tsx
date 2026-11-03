import SpecialImageView from "../specialImage/SpecialImageView";
import type { HandlerViewProps } from "../types";

/** HEIC/HEIF tab through the installed Windows codec (Step 07g D6). */
export default function CodecImageView(props: HandlerViewProps) {
  return <SpecialImageView {...props} kind="codec_image" />;
}
