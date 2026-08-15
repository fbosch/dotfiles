import GLib from "gi://GLib?version=2.0";
import type { ForceQuitApplication, ForceQuitMetrics } from "./model";

interface ProcessSample {
	ticks: number;
	sampledAtUs: number;
}

const clockTicksPerSecond = 100;
const pageSizeBytes = 4096;

export class ForceQuitMetricsSampler {
	readonly #samples = new Map<number, ProcessSample>();

	sample(applications: ForceQuitApplication[]): Map<string, ForceQuitMetrics> {
		const sampledAtUs = GLib.get_monotonic_time();
		const activePids = new Set<number>();
		const metrics = new Map<string, ForceQuitMetrics>();
		for (const application of applications) {
			let cpuPercent = 0;
			let hasCpuSample = false;
			let residentMemoryBytes = 0;
			for (const pid of application.pids) {
				activePids.add(pid);
				const stat = readProcessStat(pid);
				if (!stat) continue;
				residentMemoryBytes += stat.residentMemoryBytes;
				const previous = this.#samples.get(pid);
				if (previous) {
					const elapsedUs = sampledAtUs - previous.sampledAtUs;
					if (elapsedUs > 0) {
						cpuPercent +=
							((stat.ticks - previous.ticks) * 1_000_000 * 100) /
							(elapsedUs * clockTicksPerSecond);
						hasCpuSample = true;
					}
				}
				this.#samples.set(pid, { ticks: stat.ticks, sampledAtUs });
			}
			metrics.set(application.id, {
				cpuPercent: hasCpuSample ? Math.max(0, cpuPercent) : null,
				residentMemoryBytes,
			});
		}
		for (const pid of this.#samples.keys())
			if (activePids.has(pid) === false) this.#samples.delete(pid);
		return metrics;
	}

	clear(): void {
		this.#samples.clear();
	}
}

function readProcessStat(
	pid: number,
): { ticks: number; residentMemoryBytes: number } | null {
	try {
		const [success, contents] = GLib.file_get_contents(`/proc/${pid}/stat`);
		if (!success || !contents) return null;
		const stat = new TextDecoder().decode(contents).trim();
		const processNameEnd = stat.lastIndexOf(")");
		if (processNameEnd === -1) return null;
		const fields = stat.slice(processNameEnd + 2).split(" ");
		if (fields.length < 22) return null;
		const userTicks = Number.parseInt(fields[11], 10);
		const systemTicks = Number.parseInt(fields[12], 10);
		const residentPages = Number.parseInt(fields[21], 10);
		if (
			Number.isFinite(userTicks) === false ||
			Number.isFinite(systemTicks) === false ||
			Number.isFinite(residentPages) === false
		)
			return null;
		return {
			ticks: userTicks + systemTicks,
			residentMemoryBytes: residentPages * pageSizeBytes,
		};
	} catch {
		return null;
	}
}
