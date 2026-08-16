import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { dispatchHyprland } from "../../services/hyprland-ipc";
import type { ConfirmOperation } from "./request";

export interface ConfirmOperationDependencies {
	homeDirectory: string;
	findProgram(name: string): string | null;
	spawn(argv: string[]): void;
	dispatch(expression: string): boolean;
}

export function executeConfirmOperation(
	operation: ConfirmOperation,
	dependencies: ConfirmOperationDependencies = defaultDependencies,
): boolean {
	if (operation.type === "close-window")
		return dependencies.dispatch(
			`hl.dsp.window.close({ window = "address:${operation.address}" })`,
		);

	const hyprRuntime = `${dependencies.homeDirectory}/.config/hypr/runtime`;
	let argv: string[] | null = null;
	if (operation.type === "shutdown")
		argv = [
			`${hyprRuntime}/session/hyprshutdown-session.sh`,
			"--no-exit",
			"-t",
			"Shutting down...",
			"--post-cmd",
			"systemctl poweroff",
		];
	if (operation.type === "restart")
		argv = [
			`${hyprRuntime}/session/hyprshutdown-session.sh`,
			"-t",
			"Restarting...",
			"--post-cmd",
			"systemctl reboot",
		];
	if (operation.type === "exit-session")
		argv = [`${hyprRuntime}/session/exit-session.sh`];
	if (operation.type === "kill-process")
		argv = [
			`${hyprRuntime}/windows/kill-pid-with-fallback.sh`,
			operation.pid.toString(),
		];
	if (operation.type === "suspend") {
		const systemctl = dependencies.findProgram("systemctl");
		if (!systemctl) return false;
		argv = [systemctl, "suspend"];
	}
	if (!argv) return false;
	try {
		dependencies.spawn(argv);
		return true;
	} catch (error) {
		console.error(`Failed to execute ${operation.type}:`, error);
		return false;
	}
}

const defaultDependencies: ConfirmOperationDependencies = {
	homeDirectory: GLib.get_home_dir(),
	findProgram: (name) => GLib.find_program_in_path(name),
	spawn: (argv) => {
		Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
	},
	dispatch: (expression) =>
		dispatchHyprland(expression, {
			component: "confirm-dialog",
			metric: "confirmOperation",
		}),
};
