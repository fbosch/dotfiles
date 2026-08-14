import type { ComponentModule } from "./component-host";

type UtilityId = "about-this-pc" | "force-quit";

interface UtilityDefinition {
  load: () => Promise<unknown>;
  component: () => ComponentModule;
}

declare global {
  var AboutThisPC: ComponentModule;
  var ForceQuit: ComponentModule;
}

const utilities: Record<UtilityId, UtilityDefinition> = {
  "about-this-pc": {
    load: () => import("../components/about-this-pc.tsx"),
    component: () => globalThis.AboutThisPC,
  },
  "force-quit": {
    load: () => import("../components/force-quit.tsx"),
    component: () => globalThis.ForceQuit,
  },
};

const loadedUtilities = new Map<UtilityId, ComponentModule>();
const pendingUtilities = new Map<UtilityId, Promise<ComponentModule>>();

function isUtilityId(value: string): value is UtilityId {
  return value === "about-this-pc" || value === "force-quit";
}

function isVisibilityRequest(argv: string[]): boolean {
  try {
    const request = JSON.parse(argv.join(" ")) as { action?: unknown };
    return request?.action === "is-visible";
  } catch {
    return false;
  }
}

async function loadUtility(id: UtilityId): Promise<ComponentModule> {
  const loaded = loadedUtilities.get(id);
  if (loaded) return loaded;

  const pending = pendingUtilities.get(id);
  if (pending) return pending;

  const definition = utilities[id];
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

export function openUtility(id: UtilityId): void {
  void loadUtility(id)
    .then((component) => {
      component.handleRequest(['{"action":"show"}'], () => {});
    })
    .catch((error) => {
      console.error(`Failed to open ${id}:`, error);
    });
}

export function handleUtilityRequest(
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

export function visibleUtilityComponent(): string | null {
  for (const [id, component] of loadedUtilities) {
    let response = "";
    component.handleRequest(['{"action":"is-visible"}'], (value) => {
      response = value;
    });
    if (response === "true") return id;
  }
  return null;
}
