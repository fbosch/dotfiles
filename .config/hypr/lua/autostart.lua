-- Autostart commands ported from autostart.conf.

local commands = {
	"xrandr --output DP-2 --primary",
	"uwsm-app -s b -- hypridle",
	"uwsm-app -s s -- vicinae server",
	"uwsm-app -s s -- atuin daemon start",
	"uwsm-app -s b -- foot --server",
	"uwsm-app -s b -- flake-check-updates",
	"uwsm-app -s b -- swayosd-server",
	"uwsm-app -s b -- ~/.config/hypr/scripts/window-state.sh",
	"uwsm-app -s b -- ~/.config/hypr/scripts/minimized-state-daemon.sh",
	"uwsm-app -s b -- ~/.config/hypr/scripts/window-capture-daemon.sh",
	"uwsm-app -s b -- ~/.config/hypr/lua/runtime/gamescope/gamescope-profile-watchdog.sh",
	"uwsm-app -s b -- ~/.config/hypr/scripts/gamescope-clipboard-sync.sh",
	"~/.config/hypr/lua/runtime/startup/startup-desktop-ready.sh",
	"uwsm-app -s s -- hyprpaper",
	"uwsm-app -s s -- waybar",
	"uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css",
	"uwsm-app -s s -- ~/.config/ags/start-daemons.sh",
	"uwsm-app -s s -- ~/.config/hypr/scripts/waybar-edge-monitor.sh",
	"sh -c 'if [ -f $HOME/.config/hypr/assets/bootup.ogg ] && command -v pw-play >/dev/null 2>&1; then sleep 1.2; pw-play $HOME/.config/hypr/assets/bootup.ogg >/dev/null 2>&1 || { sleep 0.6; pw-play $HOME/.config/hypr/assets/bootup.ogg >/dev/null 2>&1 || true; }; fi'",
}

hl.on("hyprland.start", function()
	for _, command in ipairs(commands) do
		hl.exec_cmd(command)
	end
end)

return commands
