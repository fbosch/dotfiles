import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";

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

export function canDiscoverSkills(options: {
  selectedTools?: readonly string[];
  hiddenTools?: readonly string[];
}): boolean {
  const hidden = new Set(options.hiddenTools);
  const declared = new Set(options.selectedTools?.filter((name) => !hidden.has(name)));
  return declared.has("skill_search") && (declared.has("read") || declared.has("bash"));
}
