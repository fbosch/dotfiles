import { createUtilityManager, type UtilityDefinition } from "./utility-registry";
import type { ComponentModule } from "./component-host";
import { aboutThisPCLifecycle } from "@/components/about-this-pc/lifecycle";
import { requireRuntimeArtifactUri } from "./runtime-artifacts";

export type UtilityId = "about-this-pc" | "force-quit";
type ManagedUtilityId = UtilityId | "ai-pointer";

declare global {
  var AiPointer: ComponentModule;
  var ForceQuit: ComponentModule;
}

const utilities: Record<ManagedUtilityId, UtilityDefinition> = {
	"ai-pointer": {
		load: () => import(requireRuntimeArtifactUri("aiPointerModule")),
		component: () => globalThis.AiPointer,
		reportsVisibility: false,
	},
	"about-this-pc": {
		load: () => Promise.resolve(),
		component: () => aboutThisPCLifecycle,
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

export function prepareUtility(id: UtilityId): void {
	void utilityManager.prepareUtility(id);
}

export const handleUtilityRequest = utilityManager.handleRequest;
export const visibleUtilityComponent = utilityManager.visibleComponent;
