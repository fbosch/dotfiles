export interface AboutThisPCInfo {
	deviceName: string;
	manufacturer?: string;
	deviceImagePath?: string;
	deviceIcon: string;
	processor?: string;
	processorClock?: string;
	graphics?: string;
	memory?: string;
	memoryClock?: string;
	desktop?: string;
	operatingSystem?: string;
	operatingSystemIcon?: string;
	operatingSystemCodename?: string;
	nixosGeneration?: string;
	kernel?: string;
	uptime?: string;
}

export interface AboutThisPCDetail {
	label: string;
	value: string;
	icon?: string;
}

const placeholderValues = new Set([
	"default string",
	"none",
	"not applicable",
	"not specified",
	"o.e.m.",
	"system manufacturer",
	"system product name",
	"to be filled by o.e.m.",
	"unknown",
]);

export function usableValue(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	if (!normalized || placeholderValues.has(normalized.toLowerCase()))
		return undefined;
	return normalized;
}

export function parseKeyValueText(contents: string | null): Map<string, string> {
	const values = new Map<string, string>();
	if (!contents) return values;
	for (const line of contents.split("\n")) {
		const separator = line.indexOf("=");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line
			.slice(separator + 1)
			.trim()
			.replace(/^(["'])(.*)\1$/, "$2");
		values.set(key, value);
	}
	return values;
}

export function namedField(
	contents: string | null,
	name: string,
): string | undefined {
	if (!contents) return undefined;
	for (const line of contents.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1 || line.slice(0, separator).trim() !== name) continue;
		return usableValue(line.slice(separator + 1));
	}
	return undefined;
}

export function formatFrequency(megahertz: number): string | undefined {
	if (Number.isFinite(megahertz) === false || megahertz <= 0) return undefined;
	if (megahertz >= 1_000)
		return `${(megahertz / 1_000).toFixed(1).replace(/\.0$/, "")} GHz`;
	return `${Math.round(megahertz)} MHz`;
}

export function formatUptime(seconds: number): string | undefined {
	if (Number.isFinite(seconds) === false || seconds < 0) return undefined;
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
	if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
	if (days === 0 && minutes > 0)
		parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
	return parts.join(", ") || "Less than a minute";
}

export function parseGraphics(stdout: string): string | undefined {
	const devices = new Set<string>();
	for (const line of stdout.trim().split("\n")) {
		const values = Array.from(line.matchAll(/"([^"]*)"/g), (match) =>
			match[1].trim(),
		);
		if (values.length < 3) continue;
		const vendor = values[1]
			.replace(/^NVIDIA Corporation$/, "NVIDIA")
			.replace(/^Intel Corporation$/, "Intel")
			.replace(/^Advanced Micro Devices, Inc\. \[AMD\/ATI\]$/, "AMD");
		const name = values[2].match(/\[([^\]]+)\]$/)?.[1] ?? values[2];
		devices.add(
			name.toLowerCase().includes(vendor.toLowerCase())
				? name
				: `${vendor} ${name}`,
		);
	}
	return usableValue(Array.from(devices).join(", "));
}

export function parseMemoryClock(stdout: string): string | undefined {
	const speeds = Array.from(
		stdout.matchAll(/^\s*Configured Memory Speed:\s*(\d+)\s*MT\/s$/gim),
		(match) => Number.parseInt(match[1], 10),
	).filter((speed) => Number.isFinite(speed) && speed > 0);
	return speeds.length > 0 ? `${Math.max(...speeds)} MT/s` : undefined;
}

function combinedValue(primary?: string, secondary?: string): string | undefined {
	if (primary) return secondary ? `${primary} (${secondary})` : primary;
	return secondary;
}

export function aboutThisPCDetails(info: AboutThisPCInfo): AboutThisPCDetail[] {
	const operatingSystem =
		info.nixosGeneration && info.operatingSystem
			? `${[info.operatingSystem, info.operatingSystemCodename]
					.filter(Boolean)
					.join(" ")} (${info.nixosGeneration})`
			: combinedValue(info.operatingSystem, info.operatingSystemCodename);
	return [
		{ label: "CPU", value: combinedValue(info.processor, info.processorClock) },
		{ label: "GPU", value: info.graphics },
		{ label: "Memory", value: combinedValue(info.memory, info.memoryClock) },
		{ label: "Desktop", value: info.desktop },
		{ label: "OS", value: operatingSystem, icon: info.operatingSystemIcon },
		{ label: "Kernel", value: info.kernel },
		{ label: "Uptime", value: info.uptime },
	].filter((detail): detail is AboutThisPCDetail => Boolean(detail.value));
}
