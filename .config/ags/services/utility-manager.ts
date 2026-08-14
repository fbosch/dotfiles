import type { ComponentModule } from "./component-host";
import {
  createUtilityManager,
  type UtilityDefinition,
} from "./utility-registry";

export type UtilityId = "about-this-pc" | "force-quit";

declare global {
  var AboutThisPC: ComponentModule;
  var ForceQuit: ComponentModule;
}

const utilityDefinitions: Record<UtilityId, UtilityDefinition> = {
  "about-this-pc": {
    load: () => import("../components/about-this-pc.tsx"),
    component: () => globalThis.AboutThisPC,
  },
  "force-quit": {
    load: () => import("../components/force-quit.tsx"),
    component: () => globalThis.ForceQuit,
  },
};

const utilityManager = createUtilityManager(utilityDefinitions);

export function openUtility(id: UtilityId): void {
  void utilityManager.openUtility(id);
}

export function handleUtilityRequest(
  component: string,
  argv: string[],
  res: (response: string) => void,
): boolean {
  return utilityManager.handleRequest(component, argv, res);
}

export function visibleUtilityComponent(): string | null {
  return utilityManager.visibleComponent();
}
