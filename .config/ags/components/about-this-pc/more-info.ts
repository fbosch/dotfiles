import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { dispatchHyprland, queryHyprlandJson } from "@/services/hyprland-ipc";
import { usableValue } from "./model";

const moreInfoWindowClass = "about_this_pc_more_info";

export interface MoreInfoDependencies {
	configuredCommand(): string | null;
	parseArgv(command: string): string[] | null;
	findProgram(name: string): string | null;
	clients(): Array<{ address: string; class: string }> | null;
	focus(address: string): boolean;
	spawn(argv: string[]): void;
}

function moreInfoCommand(dependencies: MoreInfoDependencies): string[] | null {
	const configured =
		usableValue(dependencies.configuredCommand()) ?? "fastfetch";
	const argv = dependencies.parseArgv(configured);
	if (!argv || argv.length === 0) return null;
	const executable = dependencies.findProgram(argv[0]);
	return executable ? [executable, ...argv.slice(1)] : null;
}

export function launchAboutMoreInfo(
	dependencies: MoreInfoDependencies = defaultDependencies,
): boolean {
	const moreInfo = moreInfoCommand(dependencies);
	if (!moreInfo) return false;
	const existingWindow = dependencies
		.clients()
		?.find((client) => client.class === moreInfoWindowClass);
	if (existingWindow) return dependencies.focus(existingWindow.address);

	const terminalCommands: Array<
		[string, (terminal: string, command: string[]) => string[]]
	> = [
		[
			"footclient",
			(terminal, command) => [terminal, "-N", "-a", moreInfoWindowClass, "--hold", ...command],
		],
		[
			"foot",
			(terminal, command) => [terminal, "-a", moreInfoWindowClass, "--hold", ...command],
		],
		[
			"kitty",
			(terminal, command) => [terminal, "--class", moreInfoWindowClass, "--hold", ...command],
		],
		[
			"alacritty",
			(terminal, command) => [terminal, "--class", moreInfoWindowClass, "--hold", "-e", ...command],
		],
		[
			"xterm",
			(terminal, command) => [terminal, "-class", moreInfoWindowClass, "-hold", "-e", ...command],
		],
	];
	for (const [name, command] of terminalCommands) {
		const terminal = dependencies.findProgram(name);
		if (!terminal) continue;
		try {
			dependencies.spawn(command(terminal, moreInfo));
			return true;
		} catch (error) {
			console.error(`Failed to launch About More Info in ${name}:`, error);
			return false;
		}
	}
	return false;
}

const defaultDependencies: MoreInfoDependencies = {
	configuredCommand: () => GLib.getenv("AGS_ABOUT_MORE_INFO_COMMAND"),
	parseArgv: (command) => {
		try {
			const [success, argv] = GLib.shell_parse_argv(command);
			return success && argv ? argv : null;
		} catch (error) {
			console.error("Invalid AGS_ABOUT_MORE_INFO_COMMAND:", error);
			return null;
		}
	},
	findProgram: (name) => GLib.find_program_in_path(name),
	clients: () =>
		queryHyprlandJson<Array<{ address: string; class: string }>>("j/clients"),
	focus: (address) =>
		dispatchHyprland(`hl.dsp.focus({ window = "address:${address}" })`),
	spawn: (argv) => {
		Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
	},
};
