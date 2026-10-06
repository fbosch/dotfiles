import {
  type ExtensionAPI,
  formatSkillsForPrompt,
  type Skill,
} from "@earendil-works/pi-coding-agent";

const START = "<available_skills>";
const END = "</available_skills>";

const CATALOG_REQUEST = "dotfiles:skill-catalog:read";
interface CatalogRequest {
  options: { skills?: Skill[] };
  catalog?: readonly Skill[];
}

export function fullSkillCatalog(
  events: ExtensionAPI["events"],
  options: { skills?: Skill[] },
): readonly Skill[] {
  const request: CatalogRequest = { options };
  events.emit(CATALOG_REQUEST, request);
  if (request.catalog === undefined) {
    // Pi can load shared modules separately per extension. The event bus owns one snapshot cache for all handlers.
    const catalogs = new WeakMap<object, readonly Skill[]>();
    events.on(CATALOG_REQUEST, (data: unknown) => {
      const incoming = data as CatalogRequest;
      let catalog = catalogs.get(incoming.options);
      if (catalog === undefined) {
        catalog = [...(incoming.options.skills ?? [])];
        catalogs.set(incoming.options, catalog);
      }
      incoming.catalog = catalog;
    });
    events.emit(CATALOG_REQUEST, request);
  }
  if (request.catalog === undefined) throw new Error("Skill catalog request was not handled");
  return request.catalog;
}

export function replaceSkillCatalog(
  prompt: string,
  skills: readonly Skill[],
  readTool: "read" | "bash",
): string {
  const start = prompt.indexOf(START);
  if (start < 0) return prompt;
  const end = prompt.indexOf(END, start);
  if (end < 0) throw new Error("Skill catalog is missing its closing tag");
  // Preserve the host's wrapper and routing prose; SDK and installed Pi versions may format them differently.
  const formatted = formatSkillsForPrompt([...skills], readTool);
  const replacementStart = formatted.indexOf(START);
  const replacementEnd = formatted.indexOf(END, replacementStart);
  const replacement =
    replacementStart < 0 ? "" : formatted.slice(replacementStart, replacementEnd + END.length);
  return prompt.slice(0, start) + replacement + prompt.slice(end + END.length);
}
