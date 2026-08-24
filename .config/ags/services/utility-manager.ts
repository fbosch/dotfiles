import { createUtilityManager, type UtilityDefinition } from "./utility-registry";
import type { ComponentModule } from "./component-host";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { aboutThisPCLifecycle } from "@/components/about-this-pc/lifecycle";

export type UtilityId = "about-this-pc" | "force-quit";
type ManagedUtilityId = UtilityId | "ai-pointer";

const AI_POINTER_MODULE_PATH = "AGS_AI_POINTER_MODULE_PATH";

declare global {
  var AiPointer: ComponentModule;
  var ForceQuit: ComponentModule;
}

const utilities: Record<ManagedUtilityId, UtilityDefinition> = {
	"ai-pointer": {
		load: () => import(aiPointerModuleUri()),
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

function aiPointerModuleUri(): string {
	const path = GLib.getenv(AI_POINTER_MODULE_PATH);
	if (!path) throw new Error(`${AI_POINTER_MODULE_PATH} is unavailable`);
	return Gio.File.new_for_path(path).get_uri();
}

const utilityManager = createUtilityManager(utilities);

export function openUtility(id: UtilityId): void {
	void utilityManager.openUtility(id);
}

export const handleUtilityRequest = utilityManager.handleRequest;
export const visibleUtilityComponent = utilityManager.visibleComponent;
