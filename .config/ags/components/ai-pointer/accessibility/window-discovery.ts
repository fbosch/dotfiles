import Atspi from "gi://Atspi?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { boundedName, rectangle, visible } from "./helper-candidate";
import type { AccessibilityHelperInput } from "./helper-input";
import {
	chooseAccessibilityWindow,
	type AccessibilityWindowCandidate,
} from "./window-policy";

const maximumApplications = 32;
const maximumWindows = 32;

interface Timing {
	durationMs: number;
	startMs: number;
}

interface DiscoveryTimings {
	applicationDiscovery: Timing;
	windowMatching: Timing;
}

function nowMs(): number {
	return GLib.get_monotonic_time() / 1000;
}

function measure<T>(timing: Timing, operation: () => T): T {
	const startMs = nowMs();
	if (timing.durationMs === 0) timing.startMs = startMs;
	try {
		return operation();
	} finally {
		timing.durationMs += nowMs() - startMs;
	}
}

function active(accessible: Atspi.Accessible): boolean {
	try {
		const states = accessible.get_state_set();
		return states.contains(Atspi.StateType.ACTIVE) || states.contains(Atspi.StateType.FOCUSED);
	} catch {
		return false;
	}
}

export function matchingWindow(
	desktop: Atspi.Accessible,
	input: AccessibilityHelperInput,
	timings: DiscoveryTimings,
): Atspi.Accessible | null {
	const applications = measure(timings.applicationDiscovery, () => {
		let childCount: number;
		try {
			childCount = desktop.get_child_count();
		} catch {
			return null;
		}
		if (childCount < 0 || childCount > maximumApplications) return null;
		const discovered: Array<{ accessible: Atspi.Accessible; exactPid: boolean }> = [];
		for (let index = 0; index < childCount; index += 1) {
			try {
				const application = desktop.get_child_at_index(index);
				if (!application) return null;
				let exactPid = false;
				try {
					exactPid = application.get_process_id() === input.pid;
				} catch {
					// PID-less applications remain eligible for the conservative fallback.
				}
				discovered.push({ accessible: application, exactPid });
			} catch {
				return null;
			}
		}
		return discovered;
	});
	if (!applications) return null;
	return measure(timings.windowMatching, () => {
		const exactCandidates = collectWindowCandidates(
			applications.filter(({ exactPid }) => exactPid),
			input,
		);
		if (!exactCandidates) return null;
		if (exactCandidates.length > 0) return chooseAccessibilityWindow(exactCandidates);

		const fallbackCandidates = collectWindowCandidates(
			applications.filter(({ exactPid }) => exactPid === false),
			input,
		);
		return fallbackCandidates ? chooseAccessibilityWindow(fallbackCandidates) : null;
	});
}

function collectWindowCandidates(
	applications: Array<{ accessible: Atspi.Accessible; exactPid: boolean }>,
	input: AccessibilityHelperInput,
): AccessibilityWindowCandidate<Atspi.Accessible>[] | null {
	const candidates: AccessibilityWindowCandidate<Atspi.Accessible>[] = [];
	for (const { accessible, exactPid } of applications) {
		const matches = matchingApplicationWindows(accessible, input);
		if (!matches) return null;
		candidates.push(...matches.map((candidate) => ({ ...candidate, exactPid })));
	}
	return candidates;
}

function matchingApplicationWindows(
	application: Atspi.Accessible,
	input: AccessibilityHelperInput,
): Array<{ active: boolean; titleMatch: boolean; value: Atspi.Accessible }> | null {
	let childCount: number;
	try {
		childCount = application.get_child_count();
	} catch {
		return null;
	}
	if (childCount < 0 || childCount > maximumWindows) return null;
	const tolerance = Math.max(32, Math.round(Math.max(input.windowWidth, input.windowHeight) * 0.05));
	const matches: Array<{ active: boolean; titleMatch: boolean; value: Atspi.Accessible }> = [];
	for (let index = 0; index < childCount; index += 1) {
		try {
			const window = application.get_child_at_index(index);
			if (!window || visible(window) === false) continue;
			const geometry = rectangle(window);
			if (!geometry) continue;
			if (
				Math.abs(geometry.width - input.windowWidth) <= tolerance &&
				Math.abs(geometry.height - input.windowHeight) <= tolerance
			)
				matches.push({
					active: active(window),
					titleMatch: input.windowTitle !== undefined && boundedName(window) === input.windowTitle,
					value: window,
				});
		} catch {
			return null;
		}
	}
	return matches;
}
