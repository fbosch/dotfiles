import { createUtilityManager, type UtilityDefinition } from "./utility-registry";
import type { ComponentModule } from "./component-host";

type UtilityId = "about-this-pc" | "force-quit";

declare global {
  var AboutThisPC: ComponentModule;
  var ForceQuit: ComponentModule;
}

const utilities: Record<UtilityId, UtilityDefinition> = {
	"about-this-pc": {
		load: () => import("../components/about-this-pc/index"),
		component: () => globalThis.AboutThisPC,
	},
	"force-quit": {
		load: () => import("../components/force-quit/index"),
		component: () => globalThis.ForceQuit,
	},
};

const utilityManager = createUtilityManager(utilities);

export function openUtility(id: UtilityId): void {
  void utilityManager.openUtility(id);
}

export const handleUtilityRequest = utilityManager.handleRequest;
export const visibleUtilityComponent = utilityManager.visibleComponent;
