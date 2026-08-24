import type { ComponentModule } from "./component-host";

export interface UtilityDefinition {
  load: () => Promise<unknown>;
  component: () => ComponentModule;
  reportsVisibility?: boolean;
}

export interface UtilityManager {
  openUtility: (id: string) => Promise<void>;
  handleRequest: (
    component: string,
    argv: string[],
    res: (response: string) => void,
  ) => boolean;
  visibleComponent: () => string | null;
}

function isVisibilityRequest(argv: string[]): boolean {
  try {
    const request = JSON.parse(argv.join(" ")) as { action?: unknown };
    return request?.action === "is-visible";
  } catch {
    return false;
  }
}

export function createUtilityManager(
  definitions: Record<string, UtilityDefinition>,
): UtilityManager {
  const loadedUtilities = new Map<string, ComponentModule>();
  const pendingUtilities = new Map<string, Promise<ComponentModule>>();

  function isUtilityId(value: string): boolean {
    return Object.hasOwn(definitions, value);
  }

  async function loadUtility(id: string): Promise<ComponentModule> {
    const loaded = loadedUtilities.get(id);
    if (loaded) return loaded;

    const pending = pendingUtilities.get(id);
    if (pending) return pending;

    const definition = definitions[id];
    const loading = definition
      .load()
      .then(() => {
        const component = definition.component();
        component.init();
        loadedUtilities.set(id, component);
        return component;
      })
      .finally(() => {
        pendingUtilities.delete(id);
      });
    pendingUtilities.set(id, loading);
    return loading;
  }

  function openUtility(id: string): Promise<void> {
    if (isUtilityId(id) === false) {
      console.error(`Unknown utility: ${id}`);
      return Promise.resolve();
    }

    return loadUtility(id)
      .then((component) => {
        component.handleRequest(['{"action":"show"}'], () => {});
      })
      .catch((error) => {
        console.error(`Failed to open ${id}:`, error);
      });
  }

  function handleRequest(
    component: string,
    argv: string[],
    res: (response: string) => void,
  ): boolean {
    if (isUtilityId(component) === false) return false;

    const loaded = loadedUtilities.get(component);
    if (loaded) {
      loaded.handleRequest(argv, res);
      return true;
    }

    if (isVisibilityRequest(argv)) {
      res("false");
      return true;
    }

    void loadUtility(component)
      .then((utility) => utility.handleRequest(argv, res))
      .catch((error) => {
        console.error(`Failed to load ${component}:`, error);
        res("error: utility unavailable");
      });
    return true;
  }

  function visibleComponent(): string | null {
    for (const [id, component] of loadedUtilities) {
      if (definitions[id]?.reportsVisibility === false) continue;
      let response = "";
      component.handleRequest(['{"action":"is-visible"}'], (value) => {
        response = value;
      });
      if (response === "true") return id;
    }
    return null;
  }

  return { openUtility, handleRequest, visibleComponent };
}
