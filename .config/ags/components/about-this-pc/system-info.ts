import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import {
	formatFrequency,
	formatUptime,
	namedField,
	parseGraphics,
	parseKeyValueText,
	parseMemoryClock,
	type AboutThisPCInfo,
	usableValue,
} from "./model";

const desktopIcon = "\uE7FB";
const laptopIcon = "\uE7F8";
const portableChassisTypes = new Set([8, 9, 10, 11, 14, 30, 31, 32]);
const hardwareProbeTimeoutMs = 3_000;
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

function readTextFile(path: string): string | null {
	try {
		const [success, contents] = GLib.file_get_contents(path);
		if (!success || !contents) return null;
		return new TextDecoder().decode(contents).trim() || null;
	} catch {
		return null;
	}
}

export async function runHardwareProbe(
	argv: string[],
	parentCancellable: Gio.Cancellable | null,
	timeoutMs = hardwareProbeTimeoutMs,
): Promise<string | undefined> {
	let process: Gio.Subprocess;
	try {
		process = Gio.Subprocess.new(
			argv,
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
	} catch (error) {
		console.error(`Failed to start ${argv[0]}:`, error);
		return undefined;
	}
	const cancellable = new Gio.Cancellable();
	const cancellationId = parentCancellable?.connect(() => {
		cancellable.cancel();
		process.force_exit();
	});
	if (parentCancellable?.is_cancelled()) {
		cancellable.cancel();
		process.force_exit();
	}
	let timeoutId = GLib.timeout_add(
		GLib.PRIORITY_DEFAULT,
		timeoutMs,
		() => {
			timeoutId = 0;
			cancellable.cancel();
			process.force_exit();
			return GLib.SOURCE_REMOVE;
		},
	);
	try {
		const [stdout] = await process.communicate_utf8_async(null, cancellable);
		return process.get_successful() && stdout ? stdout : undefined;
	} catch {
		return undefined;
	} finally {
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		if (cancellationId !== undefined) parentCancellable?.disconnect(cancellationId);
	}
}

async function graphicsInfo(cancellable: Gio.Cancellable | null) {
	const executable = GLib.find_program_in_path("lspci");
	if (!executable) return undefined;
	const stdout = await runHardwareProbe(
		[executable, "-mm", "-d", "::03xx"],
		cancellable,
	);
	return stdout ? parseGraphics(stdout) : undefined;
}

async function memoryClockInfo(cancellable: Gio.Cancellable | null) {
	const executable = GLib.find_program_in_path("dmidecode");
	if (!executable) return undefined;
	const stdout = await runHardwareProbe(
		[executable, "--type", "memory"],
		cancellable,
	);
	return stdout ? parseMemoryClock(stdout) : undefined;
}

function processorInfo(): Pick<AboutThisPCInfo, "processor" | "processorClock"> {
	const cpuInfo = readTextFile("/proc/cpuinfo");
	const model = namedField(cpuInfo, "model name")
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
	const currentMegahertz = Number.parseFloat(namedField(cpuInfo, "cpu MHz") ?? "");
	return {
		processor: usableValue(model),
		processorClock: formatFrequency(
			Number.isFinite(maximumKilohertz)
				? maximumKilohertz / 1_000
				: currentMegahertz,
		),
	};
}

function memoryInfo(): string | undefined {
	const kilobytes = Number.parseInt(
		namedField(readTextFile("/proc/meminfo"), "MemTotal") ?? "",
		10,
	);
	if (Number.isFinite(kilobytes) === false || kilobytes <= 0) return undefined;
	return `${(kilobytes / 1024 ** 2).toFixed(1).replace(/\.0$/, "")} GB`;
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
			Gio.FileQueryInfoFlags.NONE,
			null,
		);
		if (
			info.get_file_type() !== Gio.FileType.REGULAR ||
			info.get_attribute_boolean("access::can-read") === false
		)
			return undefined;
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
		const generationTarget = GLib.file_read_link(`${profilesPath}/${profileTarget}`);
		const currentSystem = GLib.file_read_link("/run/current-system");
		return generationTarget === currentSystem ? generation : undefined;
	} catch {
		return undefined;
	}
}

export async function getAboutThisPCInfo(
	cancellable: Gio.Cancellable | null,
): Promise<AboutThisPCInfo> {
	const osRelease = parseKeyValueText(readTextFile("/etc/os-release"));
	const productName = usableValue(readTextFile("/sys/class/dmi/id/product_name"));
	const manufacturer = usableValue(readTextFile("/sys/class/dmi/id/sys_vendor"));
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
	const [graphics, memoryClock] = await Promise.all([
		graphicsInfo(cancellable),
		memoryClockInfo(cancellable),
	]);
	const uptimeSeconds = Number.parseFloat(
		readTextFile("/proc/uptime")?.split(" ")[0] ?? "",
	);
	return {
		deviceName: productName ?? GLib.get_host_name(),
		manufacturer,
		deviceImagePath: configuredImagePath(),
		deviceIcon: deviceIcon(),
		...processorInfo(),
		graphics,
		memory: memoryInfo(),
		memoryClock,
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
		uptime: formatUptime(uptimeSeconds),
	};
}
