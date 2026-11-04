import { useEffect, useRef, useState } from "react";
import type { PaletteRegistry } from "./PaletteRegistry";
import type { PaletteEntry } from "./types";
import { preindexPalette } from "./matchPalette";

export function usePaletteCatalog(registry: PaletteRegistry, locale: string) {
  const generation = useRef(0);
  const [state, setState] = useState<{ entries: readonly PaletteEntry[]; loading: boolean; error: string | null }>({ entries: [], loading: true, error: null });
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const current = ++generation.current;
    setSlow(false);
    const timer = window.setTimeout(() => { if (generation.current === current) setSlow(true); }, 1000);
    setState({ entries: [], loading: true, error: null });
    void registry.collect().then((entries) => {
      if (generation.current === current) {
        window.clearTimeout(timer); setSlow(false);
        preindexPalette(entries, locale);
        setState({ entries, loading: false, error: null });
      }
    }, (error: unknown) => {
      if (generation.current === current) {
        const code = error instanceof Error && error.message === "palette.invalid" ? "errors.palette.invalid" : "errors.palette.unavailable";
        setState({ entries: [], loading: false, error: code }); setSlow(false);
      }
      window.clearTimeout(timer);
    });
    return () => { generation.current += 1; window.clearTimeout(timer); };
  }, [registry, locale]);
  return { ...state, slow };
}
