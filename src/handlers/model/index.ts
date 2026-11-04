import { Box } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** 3D model files (Step 07g): STL, OBJ, glTF/GLB and 3MF through the
 * isolated model helper; the main view sees only a validated SafeScene. */
export const modelHandler: Handler = {
  id: "model",
  version: 1,
  labelKey: "handlers.model",
  icon: Box,
  accent: "image",
  extensions: ["stl", "obj", "gltf", "glb", "3mf"],
  mimeTypes: [
    "model/stl",
    "model/obj",
    "model/gltf+json",
    "model/gltf-binary",
    "model/3mf",
    "application/vnd.ms-package.3dmanufacturing-3dmodel+zip",
  ],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-3d-models",
  speedTier: "fast",
  supportsFind: false,
  editable: false,
  view: lazy(() => import("./ModelView")),
};
