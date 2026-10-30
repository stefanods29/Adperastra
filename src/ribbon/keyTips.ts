import { createContext } from "react";

/** True while the Alt key is held (App.tsx provides it): ribbons show
 * their key-tip letters. */
export const KeyTipsContext = createContext(false);
