import { createUtilityManager, type UtilityDefinition } from "./utility-registry";
import { createUtilityPrefetch } from "./utility-prefetch";
import type { ComponentModule } from "./component-host";
import GLib from "gi://GLib?version=2.0";
import { createIsolatedAboutThisPCComponent } from "@/components/about-this-pc/isolated-component";
import {
	connectIsolatedAboutThisPCShutdown,
	launchIsolatedAboutThisPC,
} from "@/components/about-this-pc/isolated-process";

export type UtilityId = "about-this-pc" | "force-quit";
export type PrefetchableUtilityId = "about-this-pc";
type ManagedUtilityId = UtilityId | "ai-pointer";

const PREFETCH_RELEASE_DELAY_MS = 1_000;

declare global {
  var AiPointer: ComponentModule;
  var ForceQuit: ComponentModule;
}

const aboutThisPC = createIsolatedAboutThisPCComponent({
	launch: launchIsolatedAboutThisPC,
	onShutdown: connectIsolatedAboutThisPCShutdown,
});

const utilities: Record<ManagedUtilityId, UtilityDefinition> = {
	"ai-pointer": {
		load: () => import("@/components/ai-pointer/index"),
		component: () => globalThis.AiPointer,
		reportsVisibility: false,
	},
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

function requestUtility(id: UtilityId, action: string): void {
	if (
		utilityManager.handleRequest(
			id,
			[JSON.stringify({ action })],
			(response) => {
				if (response.startsWith("error:"))
					console.error(`Failed to ${action} ${id}: ${response}`);
			},
		) === false
	)
		console.error(`Unknown utility: ${id}`);
}

const aboutThisPCPrefetch = createUtilityPrefetch<PrefetchableUtilityId>({
	prepare: (id) => requestUtility(id, "prepare"),
	cancel: (id) => requestUtility(id, "cancel-prepare"),
	activate: (id) => void utilityManager.openUtility(id),
	schedule: (callback) => {
		let sourceId = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			PREFETCH_RELEASE_DELAY_MS,
			() => {
				sourceId = 0;
				callback();
				return GLib.SOURCE_REMOVE;
			},
		);
		return () => {
			if (sourceId === 0) return;
			GLib.source_remove(sourceId);
			sourceId = 0;
		};
	},
});

export function openUtility(id: UtilityId): void {
	if (id === "about-this-pc") {
		aboutThisPCPrefetch.activate(id);
		return;
	}
	void utilityManager.openUtility(id);
}

export function prepareUtility(id: PrefetchableUtilityId): void {
	aboutThisPCPrefetch.intentStart(id);
}

export function releaseUtilityPreparation(id: PrefetchableUtilityId): void {
	aboutThisPCPrefetch.intentEnd(id);
}

export function clearUtilityPreparationIntent(id: PrefetchableUtilityId): void {
	aboutThisPCPrefetch.intentClear(id);
}

export const handleUtilityRequest = utilityManager.handleRequest;
export const visibleUtilityComponent = utilityManager.visibleComponent;
