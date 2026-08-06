import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

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

const desktopIcon = "\uE7FB";
const laptopIcon = "\uE7F8";
const portableChassisTypes = new Set([8, 9, 10, 11, 14, 30, 31, 32]);
const distroIcons: Record<string, string> = {
	alpine: "\uF300",
	arch: "\uF303",
	centos: "\uF304",
	debian: "\uF306",
	fedora: "\uF30A",
	gentoo: "\uF30D",
	linuxmint: "\uF30E",
	manjaro: "\uF312",
	nixos: "\uF313",
	opensuse: "\uF314",
	redhat: "\uF316",
	rhel: "\uF316",
	ubuntu: "\uF31B",
};
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

function readTextFile(path: string): string | null {
	try {
		const [success, contents] = GLib.file_get_contents(path);
		if (!success || !contents) return null;
		return new TextDecoder().decode(contents).trim() || null;
	} catch {
		return null;
	}
}

function usableValue(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	if (!normalized || placeholderValues.has(normalized.toLowerCase())) {
		return undefined;
	}
	return normalized;
}

function parseKeyValueFile(path: string): Map<string, string> {
	const values = new Map<string, string>();
	const contents = readTextFile(path);
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

function field(contents: string | null, name: string): string | undefined {
	if (!contents) return undefined;
	const prefix = `${name}:`;
	for (const line of contents.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1 || `${line.slice(0, separator).trim()}:` !== prefix) {
			continue;
		}
		return usableValue(line.slice(separator + 1));
	}
	return undefined;
}

function formatFrequency(megahertz: number): string | undefined {
	if (Number.isFinite(megahertz) === false || megahertz <= 0) return undefined;
	if (megahertz >= 1_000) {
		return `${(megahertz / 1_000).toFixed(1).replace(/\.0$/, "")} GHz`;
	}
	return `${Math.round(megahertz)} MHz`;
}

function processorInfo(): Pick<
	AboutThisPCInfo,
	"processor" | "processorClock"
> {
	const cpuInfo = readTextFile("/proc/cpuinfo");
	const model = field(cpuInfo, "model name")
		?.replace(/\((?:R|TM)\)/g, "")
		.replace(/\s+CPU(?:\s+@\s+[\d.]+GHz)?$/i, "")
		.replace(/\s{2,}/g, " ")
		.trim();
	const maximumFrequency = readTextFile(
		"/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq",
	);
	const maximumKilohertz = maximumFrequency
		? Number.parseFloat(maximumFrequency)
		: Number.NaN;
	const currentMegahertz = Number.parseFloat(field(cpuInfo, "cpu MHz") ?? "");
	const processorClock = formatFrequency(
		Number.isFinite(maximumKilohertz)
			? maximumKilohertz / 1_000
			: currentMegahertz,
	);

	return { processor: usableValue(model), processorClock };
}

function graphicsInfo(): string | undefined {
	const executable = GLib.find_program_in_path("lspci");
	if (!executable) return undefined;

	try {
		const process = Gio.Subprocess.new(
			[executable, "-mm", "-d", "::03xx"],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
		const [, stdout] = process.communicate_utf8(null, null);
		if (process.get_successful() === false || !stdout) return undefined;

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
			const bracketedName = values[2].match(/\[([^\]]+)\]$/)?.[1];
			const name = bracketedName ?? values[2];
			devices.add(
				name.toLowerCase().includes(vendor.toLowerCase())
					? name
					: `${vendor} ${name}`,
			);
		}
		return usableValue(Array.from(devices).join(", "));
	} catch (error) {
		console.error("Failed to read graphics information:", error);
		return undefined;
	}
}

function memoryInfo(): string | undefined {
	const kilobytes = Number.parseInt(
		field(readTextFile("/proc/meminfo"), "MemTotal") ?? "",
		10,
	);
	if (Number.isFinite(kilobytes) === false || kilobytes <= 0) return undefined;
	return `${(kilobytes / 1024 ** 2).toFixed(1).replace(/\.0$/, "")} GB`;
}

function memoryClockInfo(): string | undefined {
	const executable = GLib.find_program_in_path("dmidecode");
	if (!executable) return undefined;

	try {
		const process = Gio.Subprocess.new(
			[executable, "--type", "memory"],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
		const [, stdout] = process.communicate_utf8(null, null);
		if (process.get_successful() === false || !stdout) return undefined;

		const speeds = Array.from(
			stdout.matchAll(/^\s*Configured Memory Speed:\s*(\d+)\s*MT\/s$/gim),
			(match) => Number.parseInt(match[1], 10),
		).filter((speed) => Number.isFinite(speed) && speed > 0);
		if (speeds.length === 0) return undefined;
		return `${Math.max(...speeds)} MT/s`;
	} catch {
		return undefined;
	}
}

function formatUptime(): string | undefined {
	const seconds = Number.parseFloat(
		readTextFile("/proc/uptime")?.split(" ")[0] ?? "",
	);
	if (Number.isFinite(seconds) === false || seconds < 0) return undefined;

	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
	if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
	if (days === 0 && minutes > 0) {
		parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
	}
	return parts.join(", ") || "Less than a minute";
}

function configuredImagePath(): string | undefined {
	const configured = usableValue(GLib.getenv("AGS_ABOUT_DEVICE_IMAGE"));
	if (!configured) return undefined;
	const expanded = configured.startsWith("~/")
		? `${GLib.get_home_dir()}/${configured.slice(2)}`
		: configured;
	const path = GLib.canonicalize_filename(expanded, GLib.get_home_dir());

	try {
		const info = Gio.File.new_for_path(path).query_info(
			"standard::type,access::can-read",
			Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
			null,
		);
		if (
			info.get_file_type() !== Gio.FileType.REGULAR ||
			info.get_attribute_boolean("access::can-read") === false
		) {
			return undefined;
		}
		return path;
	} catch {
		return undefined;
	}
}

function deviceIcon(): string {
	const chassisType = Number.parseInt(
		readTextFile("/sys/class/dmi/id/chassis_type") ?? "",
		10,
	);
	return portableChassisTypes.has(chassisType) ? laptopIcon : desktopIcon;
}

function nixosGeneration(): string | undefined {
	const profilesPath = "/nix/var/nix/profiles";
	try {
		const profileTarget = GLib.file_read_link(`${profilesPath}/system`);
		const generation = profileTarget.match(/^system-(\d+)-link$/)?.[1];
		if (!generation) return undefined;

		const generationTarget = GLib.file_read_link(
			`${profilesPath}/${profileTarget}`,
		);
		const currentSystem = GLib.file_read_link("/run/current-system");
		return generationTarget === currentSystem ? generation : undefined;
	} catch {
		return undefined;
	}
}

export function getAboutThisPCInfo(): AboutThisPCInfo {
	const osRelease = parseKeyValueFile("/etc/os-release");
	const productName = usableValue(
		readTextFile("/sys/class/dmi/id/product_name"),
	);
	const manufacturer = usableValue(
		readTextFile("/sys/class/dmi/id/sys_vendor"),
	);
	const osName = usableValue(osRelease.get("NAME"));
	const osVersion = usableValue(osRelease.get("VERSION_ID"));
	const operatingSystem =
		[osName, osVersion].filter(Boolean).join(" ") ||
		usableValue(osRelease.get("PRETTY_NAME"));
	const codename = usableValue(osRelease.get("VERSION_CODENAME"));
	const desktop = usableValue(
		GLib.getenv("XDG_CURRENT_DESKTOP")?.split(":").find(Boolean),
	);
	const kernelRelease = usableValue(readTextFile("/proc/sys/kernel/osrelease"));

	return {
		deviceName: productName ?? GLib.get_host_name(),
		manufacturer,
		deviceImagePath: configuredImagePath(),
		deviceIcon: deviceIcon(),
		...processorInfo(),
		graphics: graphicsInfo(),
		memory: memoryInfo(),
		memoryClock: memoryClockInfo(),
		desktop,
		operatingSystem: usableValue(operatingSystem),
		operatingSystemIcon:
			distroIcons[osRelease.get("ID")?.toLowerCase() ?? ""] ?? "\uF17C",
		operatingSystemCodename: codename
			? codename.charAt(0).toUpperCase() + codename.slice(1)
			: undefined,
		nixosGeneration:
			osRelease.get("ID")?.toLowerCase() === "nixos"
				? nixosGeneration()
				: undefined,
		kernel: kernelRelease ? `Linux ${kernelRelease}` : undefined,
		uptime: formatUptime(),
	};
}

function moreInfoCommand(): string[] | null {
	const configured =
		usableValue(GLib.getenv("AGS_ABOUT_MORE_INFO_COMMAND")) ?? "fastfetch";
	try {
		const [success, argv] = GLib.shell_parse_argv(configured);
		if (!success || !argv || argv.length === 0) return null;

		const executable = GLib.find_program_in_path(argv[0]);
		if (!executable) return null;
		return [executable, ...argv.slice(1)];
	} catch (error) {
		console.error("Invalid AGS_ABOUT_MORE_INFO_COMMAND:", error);
		return null;
	}
}

export function launchAboutMoreInfo(): boolean {
	const moreInfo = moreInfoCommand();
	if (!moreInfo) return false;

	const terminalCommands: Array<
		[string, (terminal: string, command: string[]) => string[]]
	> = [
		["foot", (terminal, command) => [terminal, "--hold", ...command]],
		["kitty", (terminal, command) => [terminal, "--hold", ...command]],
		[
			"alacritty",
			(terminal, command) => [terminal, "--hold", "-e", ...command],
		],
		["xterm", (terminal, command) => [terminal, "-hold", "-e", ...command]],
	];
	for (const [name, command] of terminalCommands) {
		const terminal = GLib.find_program_in_path(name);
		if (!terminal) continue;
		try {
			Gio.Subprocess.new(command(terminal, moreInfo), Gio.SubprocessFlags.NONE);
			return true;
		} catch (error) {
			console.error(`Failed to launch About More Info in ${name}:`, error);
			return false;
		}
	}
	return false;
}
