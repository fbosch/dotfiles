export function focusAndWarpCommand(address: string, home: string | null): string {
	const script = home
		? `luajit ${home}/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua`
		: "luajit ~/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua";
	return `${script} --window ${shellQuote(address)}`;
}

export function restoreMinimizedCommand(
	address: string,
	home: string | null,
): string {
	const script = home
		? `${home}/.config/hypr/runtime/windows/toggle-minimized-workspace.sh`
		: "~/.config/hypr/runtime/windows/toggle-minimized-workspace.sh";
	return `${script} ${shellQuote(address)}`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
