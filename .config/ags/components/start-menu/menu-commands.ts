import GLib from "gi://GLib?version=2.0";

const homeDir = GLib.get_home_dir();

export const sessionActionIds = new Set([
	"lock-screen",
	"sign-out",
	"suspend",
	"restart",
	"shutdown",
]);

export function createMenuCommands(): Record<string, string> {
	const updatesCommand = `${homeDir}/.config/ags/scripts/flake-update-terminal.sh`;
	return {
		"system-updates": updatesCommand,
		"system-settings": systemSettingsCommand(),
		"lock-screen": "hyprlock",
		applications: "com.github.tchx84.Flatseal",
		documents: `nemo --existing-window "${getXdgUserDir("XDG_DOCUMENTS_DIR", `${homeDir}/Documents`)}"`,
		pictures: `nemo --existing-window "${getXdgUserDir("XDG_PICTURES_DIR", `${homeDir}/Pictures`)}"`,
		downloads: `nemo --existing-window "${getXdgUserDir("XDG_DOWNLOAD_DIR", `${homeDir}/Downloads`)}"`,
		suspend: `${homeDir}/.config/hypr/runtime/session/confirm-suspend.sh`,
		"sign-out": `${homeDir}/.config/hypr/runtime/session/confirm-exit.sh`,
		restart: `${homeDir}/.config/hypr/runtime/session/confirm-restart.sh`,
		shutdown: `${homeDir}/.config/hypr/runtime/session/confirm-shutdown.sh`,
		"nixos-updates": updatesCommand,
		"flatpak-updates": updatesCommand,
	};
}

export function runMenuCommand(command: string): void {
	// Commands can contain pipes and compound shell syntax.
	GLib.spawn_command_line_async(`sh -c '${command}'`);
}

function systemSettingsCommand(): string {
	const terminal = getTerminal();
	const nixosPath = `${homeDir}/nixos`;
	switch (terminal) {
		case "foot":
		case "kitty":
			return `${terminal} sh -c "cd ${nixosPath} && nvim"`;
		case "alacritty":
			return `${terminal} -e sh -c "cd ${nixosPath} && nvim"`;
		case "wezterm":
			return `${terminal} start --cwd ${nixosPath} -- nvim`;
		case "gnome-terminal":
			return `${terminal} --working-directory=${nixosPath} -- nvim`;
		default:
			return `${terminal} -e sh -c "cd ${nixosPath} && nvim"`;
	}
}

function getTerminal(): string {
	const preferred = GLib.getenv("TERMINAL");
	if (preferred) return preferred;
	for (const terminal of [
		"foot",
		"kitty",
		"wezterm",
		"alacritty",
		"gnome-terminal",
	]) {
		if (GLib.find_program_in_path(terminal)) return terminal;
	}
	return "xterm";
}

function getXdgUserDir(key: string, fallback: string): string {
	try {
		const configDir = GLib.getenv("XDG_CONFIG_HOME") || `${homeDir}/.config`;
		const path = `${configDir}/user-dirs.dirs`;
		if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return fallback;
		const [success, contents] = GLib.file_get_contents(path);
		if (!success || !contents) return fallback;
		const text = new TextDecoder("utf-8").decode(contents);
		const match = text.match(new RegExp(`^${key}=\"?(.+?)\"?$`, "m"));
		return match ? match[1].replace(/\$HOME/g, homeDir) : fallback;
	} catch (error) {
		console.error(`Failed to read ${key} from XDG user dirs:`, error);
		return fallback;
	}
}
