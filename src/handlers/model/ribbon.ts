import type { RibbonDef } from "../../ribbon/types";

/** The 3D model ribbon (Step 07g). Data only: the view draws it through
 * `Ribbon`, and the command-layout descriptors reuse the same controls. */
export const MODEL_RIBBON: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "camera",
          labelKey: "ribbon.zoom",
          controls: [
            { type: "button", command: "model.fit", keyTip: "F" },
            { type: "toggle", command: "model.wireframe", keyTip: "W" },
            { type: "toggle", command: "model.measure", keyTip: "M" },
          ],
        },
      ],
    },
  ],
};
