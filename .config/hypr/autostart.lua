-- Autostart commands ported from autostart.conf.

local commands = {
	"xrandr --output DP-2 --primary",
	-- "uwsm-app -s b -- hypridle",
	"uwsm-app -s s -- vicinae server",
	"uwsm-app -s s -- atuin daemon start",
	"uwsm-app -s b -- foot --server",
	"uwsm-app -s b -- flake-check-updates",
	"uwsm-app -s b -- swayosd-server",
	"uwsm-app -s b -- ~/.config/hypr/runtime/windows/window-state.sh",
	"uwsm-app -s b -- ~/.config/hypr/runtime/windows/minimized-state-daemon.sh",
	"uwsm-app -s b -- ~/.config/hypr/runtime/windows/window-capture-daemon.sh",
	"uwsm-app -s b -- ~/.config/hypr/runtime/gamescope/gamescope-profile-watchdog.sh",
	"uwsm-app -s b -- ~/.config/hypr/runtime/gamescope/gamescope-clipboard-sync.sh",
	"uwsm-app -s s -- hyprpaper",
	"uwsm-app -s s -- waybar",
	"uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css",
	"uwsm-app -s s -- ~/.config/ags/start-daemons.sh",
	"uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-edge-monitor.sh",
	"~/.config/hypr/runtime/startup/startup-desktop-ready.sh",
}

local function autostart_marker_path()
	local runtime_dir = os.getenv("XDG_RUNTIME_DIR") or "/tmp"
	local instance = os.getenv("HYPRLAND_INSTANCE_SIGNATURE") or "unknown"

	return runtime_dir .. "/hypr-autostart-" .. instance .. ".done"
end

local function autostart_has_run()
	local file = io.open(autostart_marker_path(), "r")
	if file then
		file:close()
		return true
	end

	return false
end

local function mark_autostart_run()
	local file = io.open(autostart_marker_path(), "w")
	if file then
		file:write("1\n")
		file:close()
	end
end

hl.on("hyprland.start", function()
	if autostart_has_run() then
		return
	end

	mark_autostart_run()

	for _, command in ipairs(commands) do
		hl.exec_cmd(command)
	end
end)

return commands
