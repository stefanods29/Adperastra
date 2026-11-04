import type { RibbonDef } from "../../ribbon/types";

/** The image viewer ribbon (Step 04b). Data only: the view draws it through
 * `Ribbon`, and the command-layout descriptors reuse the same controls. */
export const IMAGE_RIBBON: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "zoom",
          labelKey: "ribbon.zoom",
          controls: [
            { type: "button", command: "image.zoomIn", showLabel: false, keyTip: "I" },
            { type: "button", command: "image.zoomOut", showLabel: false, keyTip: "O" },
            { type: "toggle", command: "image.fit", keyTip: "F" },
            { type: "toggle", command: "image.actualSize", keyTip: "A" },
          ],
        },
        {
          id: "rotate",
          labelKey: "ribbon.rotate",
          controls: [
            { type: "button", command: "image.rotateLeft", keyTip: "L" },
            { type: "button", command: "image.rotateRight", keyTip: "R" },
          ],
        },
        {
          id: "text",
          labelKey: "ocr.title",
          controls: [
            { type: "toggle", command: "image.textRecognition", showLabel: false },
            { type: "button", command: "image.copyAllText", showLabel: false },
            { type: "button", command: "image.searchText", showLabel: false },
          ],
        },
      ],
    },
  ],
};
