export function systemSettingsCommand(
	terminal: string,
	nixosPath: string,
): string {
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

export function parseXdgUserDir(
	text: string,
	key: string,
	homeDir: string,
): string | null {
	const match = text.match(new RegExp(`^${key}=\"?(.+?)\"?$`, "m"));
	return match ? match[1].replace(/\$HOME/g, homeDir) : null;
}
