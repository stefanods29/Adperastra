import { useEffect, useRef, type CSSProperties } from "react";
import { contrastRatio, parseThemeColor, relativeLuminance, themeColorHex } from "../appearance/themeMath";
import type { FolderBackground as Background } from "../services/folderCustomization";
import { validFolderBackground } from "../services/folderCustomization";
import type { CacheLease } from "../services/cache";
import { releaseCacheLease } from "../services/cache";
import { fileUrl } from "../services/files";

export interface FolderBackgroundProps {
  background?: Background;
  enabled: boolean;
  visible: boolean;
  /** Computed opaque pane/text tokens, refreshed by the appearance host. */
  paneColor: string;
  textColor: string;
  /** Host transfers this lease's ownership to the component. The acquisition
   * endpoint for catalog assets is still a coordinator dependency. */
  image?: { asset_id: string; lease: CacheLease };
  onWarning: (code: "folderCustom.dimmed") => void;
}

/** Composite in the same sRGB channels as the layered pane. Contrast itself
 * always uses 10a's canonical implementation. Extremes conservatively bound
 * every gradient/image pixel, not just a sample or an average color. */
export function readableBackgroundOpacity(background: Background, paneColor: string, textColor: string): number {
  if (!validFolderBackground(background) || background.kind === "none") return 0;
  const pane = parseThemeColor(paneColor);
  const text = parseThemeColor(textColor);
  if (!pane || !text || pane.alpha !== 1 || text.alpha !== 1 || contrastRatio(paneColor, textColor) < 4.5) return 0;
  // A gradient's interpolation space can vary with WebView2. Bound the full
  // RGB cube, including transparency, rather than assuming endpoint extrema.
  const colors = background.kind === "image" || background.kind === "gradient"
    ? ["#000000", "#FFFFFF"] : [background.color!];
  const parsed = colors.map(parseThemeColor);
  if (parsed.some((value) => !value || value.alpha !== 1)) return 0;
  const channels = ["red", "green", "blue"] as const;
  const extremes = [Math.min, Math.max].map((bound) => channels.map((channel) =>
    bound(...parsed.map((value) => value![channel]))));
  const textLuminance = relativeLuminance(textColor);
  for (let step = 100; step >= 0; step -= 1) {
    const opacity = background.opacity * step / 100;
    const surfaces = extremes.map((rgb, index) => {
      const bound = index === 0 ? Math.floor : Math.ceil;
      return themeColorHex(
        bound(pane.red + (rgb[0] - pane.red) * opacity),
        bound(pane.green + (rgb[1] - pane.green) * opacity),
        bound(pane.blue + (rgb[2] - pane.blue) * opacity),
      );
    });
    const low = relativeLuminance(surfaces[0]);
    const high = relativeLuminance(surfaces[1]);
    if ((textLuminance <= low || textLuminance >= high) &&
      surfaces.every((surface) => contrastRatio(textColor, surface) >= 4.5)) return opacity;
  }
  return 0;
}

/** Mounted behind already-rendered rows. No image parse or request is awaited. */
export function FolderBackground({ background, enabled, visible, paneColor, textColor, image, onWarning }: FolderBackgroundProps) {
  const active = background && validFolderBackground(background) && background.kind !== "none" && enabled && visible ? background : undefined;
  const opacity = active ? readableBackgroundOpacity(active, paneColor, textColor) : 0;
  const imageReady = !!active && !!image && active.kind === "image" && image.asset_id === active.asset_id &&
    image.lease.mime === "image/png" && !image.lease.sensitive && image.lease.byte_len > 0 &&
    image.lease.byte_len <= 4 * 1024 * 1024 && opacity > 0;
  const leaseId = image?.lease.lease_id;
  const ownership = useRef<{ leaseId: string; active: boolean } | null>(null);
  useEffect(() => {
    if (!leaseId) return;
    const owner = { leaseId, active: imageReady };
    ownership.current = owner;
    if (!imageReady) {
      void releaseCacheLease(leaseId).catch(() => { /* Native revoked/expired lease is already inert. */ });
      return;
    }
    return () => {
      owner.active = false;
      // React may replay effect setup/cleanup while keeping the same mounted
      // image. Let that setup retain the lease before finalizing a release.
      queueMicrotask(() => {
        const replacement = ownership.current;
        if (replacement?.active && replacement.leaseId === leaseId) return;
        void releaseCacheLease(leaseId).catch(() => { /* Idempotent release. */ });
      });
    };
  }, [leaseId, imageReady]);
  const dimmed = !!active && opacity < active.opacity;
  useEffect(() => { if (dimmed) onWarning("folderCustom.dimmed"); }, [dimmed, onWarning]);
  if (!active || opacity === 0 || (active.kind === "image" && !imageReady)) return null;
  const style: CSSProperties = { opacity, filter: `blur(${active.blur_px}px)` };
  if (active.kind === "solid") style.backgroundColor = active.color;
  if (active.kind === "gradient") style.backgroundImage =
    `linear-gradient(${active.angle_degrees}deg, ${active.color}, ${active.second_color})`;
  if (active.kind === "image" && imageReady && image) {
    // fileUrl alone constructs a protocol URL from an opaque grant token.
    const url = fileUrl(image.lease.token, image.lease.name);
    return <div className="adp-folder-background" aria-hidden="true" style={style}>
      {active.fit === "tile"
        ? <div className="adp-folder-background-tile" style={{ backgroundImage: `url(${JSON.stringify(url)})` }} />
        : <img src={url} alt="" className={`adp-folder-background-image adp-folder-background-${active.fit}`} />}
    </div>;
  }
  return <div className="adp-folder-background" aria-hidden="true" style={style} />;
}
