import { createUtilityManager, type UtilityDefinition } from "./utility-registry";
import type { ComponentModule } from "./component-host";
import { createIsolatedAboutThisPCComponent } from "@/components/about-this-pc/isolated-component";
import {
	connectIsolatedAboutThisPCShutdown,
	launchIsolatedAboutThisPC,
} from "@/components/about-this-pc/isolated-process";

type UtilityId = "about-this-pc" | "force-quit";

declare global {
  var ForceQuit: ComponentModule;
}

const aboutThisPC = createIsolatedAboutThisPCComponent({
	launch: launchIsolatedAboutThisPC,
	onShutdown: connectIsolatedAboutThisPCShutdown,
});

const utilities: Record<UtilityId, UtilityDefinition> = {
	"about-this-pc": {
		load: () => Promise.resolve(),
		component: () => aboutThisPC,
	},
	"force-quit": {
		load: () => import("@/components/force-quit/index"),
		component: () => globalThis.ForceQuit,
	},
};

const utilityManager = createUtilityManager(utilities);

export function openUtility(id: UtilityId): void {
  void utilityManager.openUtility(id);
}

export const handleUtilityRequest = utilityManager.handleRequest;
export const visibleUtilityComponent = utilityManager.visibleComponent;
