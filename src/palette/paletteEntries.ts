import { commandLabelKey, isCommandEnabled, isCommandVisible, type CommandRegistry } from "../commands/registry";
import { folderViewKey } from "../services/folderViews";
import type { HelpPageSummary } from "../services/help";
import { SETTINGS_SECTIONS } from "../views/settings/sections";
import type { PaletteEntry, PaletteHost, PaletteProvider } from "./types";

type Translate = (key: string) => string;
/** Entries are validated at the registry boundary, so provider text is cut
 * to the same limits instead of letting one long path reject the catalog. */
function boundedText(value: string, max: number): string {
  const scalars = [...value];
  return scalars.length <= max ? value : scalars.slice(0, max).join("");
}
function boundedKeywords(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => boundedText(value.trim(), 128)).filter(Boolean))].slice(0, 32);
}
export function commandPaletteProvider(commands: CommandRegistry, host: PaletteHost, english: Translate): PaletteProvider {
  return {
    async snapshot() {
      const context = host.commandContext();
      return commands.list().filter((command) => isCommandVisible(command, context)).map((command): PaletteEntry => {
        const label_key = commandLabelKey(command, context);
        const enabled = isCommandEnabled(command, context);
        const disabled_reason_key = enabled
          ? undefined
          : command.pending ? "commands.comingLater" : command.disabledReasonKey?.(context) ?? "palette.disabled";
        return { id: `command:${command.id}`, kind: "command", label_key, english_label: english(label_key), keywords: [], shortcut: command.shortcut,
          enabled, target_id: command.id, ...(disabled_reason_key ? { disabled_reason_key } : {}) };
      });
    },
    async dispatch(entry, currentHost) {
      const command = commands.get(entry.target_id), context = currentHost.commandContext();
      if (!command || !isCommandVisible(command, context) || !isCommandEnabled(command, context)) throw new Error("palette.unavailable");
      currentHost.dispatchCommand(command.id);
    },
  };
}
export function settingsPaletteProvider(localized: Translate, english: Translate): PaletteProvider {
  return {
    async snapshot() { return SETTINGS_SECTIONS.map((section): PaletteEntry => ({
      id: `settings:${section.id}`, kind: "settings", label_key: section.titleKey, english_label: english(section.titleKey),
      keywords: boundedKeywords(section.keywordKeys.flatMap((key) => [localized(key), english(key)])), enabled: true, target_id: section.id,
    })); },
    async dispatch(entry, host) { if (!SETTINGS_SECTIONS.some((section) => section.id === entry.target_id)) throw new Error("palette.unavailable"); host.openSettings(entry.target_id); },
  };
}
/** Receives the registered pages, not a hand-maintained help list. `listHelp`
 * returns localized titles; the host may add the English title it joined. */
export function helpPaletteProvider(snapshot: () => Promise<readonly (HelpPageSummary & { english_title?: string })[]>): PaletteProvider {
  return {
    async snapshot() {
      const entries: PaletteEntry[] = [];
      const seen = new Set<string>();
      for (const page of await snapshot()) {
        const slug = boundedText(page.slug.trim(), 512);
        const localized = page.title ? boundedText(page.title.trim(), 512) : "";
        const english = page.english_title ? boundedText(page.english_title.trim(), 512) || localized : localized;
        if (!slug || !english || seen.has(slug)) continue;
        seen.add(slug);
        entries.push({ id: `help:${slug}`, kind: "help", ...(localized ? { runtime_label: localized } : {}), english_label: english, keywords: [], enabled: true, target_id: slug });
      }
      return entries;
    },
    async dispatch(entry, host) { host.openHelp(entry.target_id); },
  };
}
/** Safe descriptors supplied by the owning tab/group/location services. Sensitive
 * sources must be removed by the owner before calling this adapter. */
export function descriptorPaletteProvider(kind: "folder" | "recent_file" | "tab" | "saved_group", snapshot: () => Promise<readonly { id: string; title: string; description?: string }[]>): PaletteProvider {
  return {
    async snapshot() {
      const entries: PaletteEntry[] = [];
      const seen = new Set<string>();
      for (const item of await snapshot()) {
        if (!item.id.trim()) continue;
        const target = kind === "folder" || kind === "recent_file" ? folderViewKey(item.id) : item.id.trim();
        const id = `${kind}:${target}`;
        const title = boundedText(item.title.trim(), 512);
        const description = item.description === undefined ? undefined : boundedText(item.description, 512) || undefined;
        if (!target || !title || [...id].length > 32768 || seen.has(target)) continue;
        seen.add(target);
        entries.push({ id, kind, english_label: title, keywords: [], description, enabled: true,
          target_id: kind === "folder" || kind === "recent_file" ? item.id : target });
      }
      return entries;
    },
    async dispatch(entry, host) {
      if (kind === "folder") await host.openFolder(entry.target_id);
      else if (kind === "recent_file") await host.openFile(entry.target_id);
      else if (kind === "tab") host.activateTab(entry.target_id);
      else await host.openSavedGroup(entry.target_id);
    },
  };
}
