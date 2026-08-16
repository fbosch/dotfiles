import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { queryHyprlandJson } from "@/services/hyprland-ipc";
import {
	accessibilityCoordinateSpace,
	accessibilityProtocolVersion,
	type AccessibilityResolution,
	type AccessibleCandidate,
	chooseAccessibleSnap,
	parseAccessibilityHelperOutput,
} from "./accessibility-policy";
import { type SelectionGeometry, validatedSelectionGeometry } from "./selection";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

const lookupTimeoutMs = 900;
const maximumHelperOutputBytes = 32_768;
const helperRelativePath = [
	"ags",
	"components",
	"ai-pointer",
	"accessibility-helper.js",
];

interface ActiveClient {
	address?: unknown;
	at?: unknown;
	hidden?: unknown;
	mapped?: unknown;
	pid?: unknown;
	size?: unknown;
	stableId?: unknown;
}

interface AccessibleHelperInput {
	coordinateSpace: typeof accessibilityCoordinateSpace;
	pid: number;
	protocolVersion: typeof accessibilityProtocolVersion;
	selection: SelectionGeometry;
	windowHeight: number;
	windowWidth: number;
}

interface ValidatedClient {
	address: string;
	geometry: SelectionGeometry;
	pid: number;
	stableId?: string;
}

type ProcessObserver = (process: Gio.Subprocess | null) => void;

export async function resolveAccessibleSelection(
	selection: SelectionGeometry,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
): Promise<AccessibilityResolution | null> {
	const client = activeClientForSelection(selection);
	if (!client) return null;
	const candidates = await queryHelper(client, selection, cancellable, onProcess);
	if (!candidates || cancellable.is_cancelled()) return null;
	const freshClient = activeClientForSelection(selection);
	if (!freshClient || sameClient(client, freshClient) === false) return null;
	return chooseAccessibleSnap(selection, candidates, freshClient.geometry);
}

function activeClientForSelection(selection: SelectionGeometry): ValidatedClient | null {
	const active = queryHyprlandJson<ActiveClient>("j/activewindow", {
		component: "ai-pointer",
		metric: "accessibleActiveWindow",
	});
	if (
		!active ||
		active.mapped === false ||
		active.hidden === true ||
		typeof active.address !== "string" ||
		active.address.length === 0 ||
		Array.isArray(active.at) === false ||
		Array.isArray(active.size) === false ||
		active.at.length !== 2 ||
		active.size.length !== 2 ||
		typeof active.pid !== "number" ||
		Number.isSafeInteger(active.pid) === false ||
		active.pid <= 0
	)
		return null;
	const geometry = validatedSelectionGeometry(
		active.at[0],
		active.at[1],
		active.size[0],
		active.size[1],
	);
	if (!geometry || containsSelectionCenter(geometry, selection) === false) return null;
	return {
		address: active.address,
		geometry,
		pid: active.pid,
		stableId: typeof active.stableId === "string" ? active.stableId : undefined,
	};
}

async function queryHelper(
	client: ValidatedClient,
	selection: SelectionGeometry,
	parentCancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
): Promise<AccessibleCandidate[] | null> {
	const configHome =
		GLib.getenv("XDG_CONFIG_HOME") ?? GLib.build_filenamev([GLib.get_home_dir(), ".config"]);
	const helperPath = GLib.build_filenamev([configHome, ...helperRelativePath]);

	let gjsExecutable: string;
	try {
		gjsExecutable = GLib.file_read_link("/proc/self/exe");
	} catch {
		return null;
	}
	const input: AccessibleHelperInput = {
		coordinateSpace: accessibilityCoordinateSpace,
		pid: client.pid,
		protocolVersion: accessibilityProtocolVersion,
		selection: {
			x: selection.x - client.geometry.x,
			y: selection.y - client.geometry.y,
			width: selection.width,
			height: selection.height,
		},
		windowHeight: client.geometry.height,
		windowWidth: client.geometry.width,
	};

	let process: Gio.Subprocess;
	try {
		process = Gio.Subprocess.new(
			[gjsExecutable, "-m", helperPath, JSON.stringify(input)],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
	} catch {
		return null;
	}

	onProcess(process);
	const cancellable = new Gio.Cancellable();
	const cancellationId = parentCancellable.connect(() => {
		cancellable.cancel();
		process.force_exit();
	});
	if (parentCancellable.is_cancelled()) {
		cancellable.cancel();
		process.force_exit();
	}
	let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, lookupTimeoutMs, () => {
		timeoutId = 0;
		cancellable.cancel();
		process.force_exit();
		return GLib.SOURCE_REMOVE;
	});

	try {
		const stdout = await readBoundedHelperOutput(process, cancellable);
		if (!stdout || process.get_successful() === false) return null;
		const localCandidates = parseAccessibilityHelperOutput(stdout);
		if (!localCandidates) return null;
		return localCandidates.map((candidate) => ({
			...candidate,
			geometry: {
				x: candidate.geometry.x + client.geometry.x,
				y: candidate.geometry.y + client.geometry.y,
				width: candidate.geometry.width,
				height: candidate.geometry.height,
			},
		}));
	} catch {
		return null;
	} finally {
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		try {
			parentCancellable.disconnect(cancellationId);
		} catch {
			// Cancellation may disconnect its handlers while unwinding.
		}
		onProcess(null);
	}
}

export async function readBoundedHelperOutput(
	process: Gio.Subprocess,
	cancellable: Gio.Cancellable,
): Promise<string | null> {
	const stream = process.get_stdout_pipe();
	if (!stream) return null;
	const chunks: Uint8Array[] = [];
	let byteCount = 0;
	while (true) {
		const bytes = await stream.read_bytes_async(4_096, GLib.PRIORITY_DEFAULT, cancellable);
		const data = bytes.get_data();
		if (!data || data.length === 0) break;
		byteCount += data.length;
		if (byteCount > maximumHelperOutputBytes) {
			process.force_exit();
			try {
				await process.wait_async(null);
			} catch {
				// The process may have exited between the oversized read and termination.
			}
			return null;
		}
		chunks.push(data.slice());
	}
	await process.wait_async(cancellable);
	const output = new Uint8Array(byteCount);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(output);
	} catch {
		return null;
	}
}

function containsSelectionCenter(client: SelectionGeometry, selection: SelectionGeometry): boolean {
	const centerX = selection.x + selection.width / 2;
	const centerY = selection.y + selection.height / 2;
	return (
		centerX >= client.x &&
		centerX < client.x + client.width &&
		centerY >= client.y &&
		centerY < client.y + client.height
	);
}

function sameClient(left: ValidatedClient, right: ValidatedClient): boolean {
	return (
		left.address === right.address &&
		left.pid === right.pid &&
		left.stableId === right.stableId &&
		left.geometry.x === right.geometry.x &&
		left.geometry.y === right.geometry.y &&
		left.geometry.width === right.geometry.width &&
		left.geometry.height === right.geometry.height
	);
}
