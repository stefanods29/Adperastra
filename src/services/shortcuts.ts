/** Shortcut text in the user's language: key names such as Shift, Enter
 * and Delete come from the translation files ("Mayús", "Entrar", "Supr"
 * in Spanish); letters and function keys stay as they are. */

const KEY_NAMES: Record<string, string> = {
  ctrl: "keys.ctrl",
  shift: "keys.shift",
  alt: "keys.alt",
  enter: "keys.enter",
  delete: "keys.delete",
  left: "keys.left",
  right: "keys.right",
  up: "keys.up",
  down: "keys.down",
  space: "keys.space",
};

export function formatShortcut(shortcut: string, t: (key: string) => string): string {
  return shortcut
    .split("+")
    .map((part) => {
      const key = KEY_NAMES[part.toLowerCase()];
      return key ? t(key) : part;
    })
    .join("+");
}
