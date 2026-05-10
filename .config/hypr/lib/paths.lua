local M = {}

local home = os.getenv("HOME")
local hypr = home .. "/.config/hypr"
local scripts = {
	["confirm-exit.sh"] = "session/confirm-exit.sh",
	["confirm-restart.sh"] = "session/confirm-restart.sh",
	["confirm-shutdown.sh"] = "session/confirm-shutdown.sh",
	["confirm-suspend.sh"] = "session/confirm-suspend.sh",
	["exit-session.sh"] = "session/exit-session.sh",
	["gamescope-clipboard-sync.sh"] = "gamescope/gamescope-clipboard-sync.sh",
	["gamescope-profile-watchdog.sh"] = "gamescope/gamescope-profile-watchdog.sh",
	["kill-pid-with-fallback.sh"] = "windows/kill-pid-with-fallback.sh",
	["minimized-state-daemon.sh"] = "windows/minimized-state-daemon.sh",
	["toggle-minimized-window.sh"] = "windows/toggle-minimized-window.sh",
	["toggle-minimized-workspace.sh"] = "windows/toggle-minimized-workspace.sh",
	["toggle-show-desktop.sh"] = "windows/toggle-show-desktop.sh",
	["window-capture-daemon.sh"] = "windows/window-capture-daemon.sh",
	["window-state.sh"] = "windows/window-state.sh",
	["window-switcher-ags.sh"] = "windows/window-switcher-ags.sh",
	["profilectl.sh"] = "profiles/profilectl.sh",
	["toggle-gaming-mode.sh"] = "profiles/toggle-gaming-mode.sh",
	["toggle-performance-mode.sh"] = "profiles/toggle-performance-mode.sh",
	["screenshot.sh"] = "capture/screenshot.sh",
	["launch-browser.sh"] = "desktop/launch-browser.sh",
	["nerd-icon-gen.sh"] = "desktop/nerd-icon-gen.sh",
	["reset-desktop.sh"] = "desktop/reset-desktop.sh",
	["restart-daemons.sh"] = "desktop/restart-daemons.sh",
	["switch-layout.sh"] = "desktop/switch-layout.sh",
	["taskbar-app.sh"] = "desktop/taskbar-app.sh",
	["toggle-hypridle.sh"] = "desktop/toggle-hypridle.sh",
	["toggle-night-light.sh"] = "desktop/toggle-night-light.sh",
	["waybar-edge-monitor.sh"] = "desktop/waybar-edge-monitor.sh",
	["waybar-lib.sh"] = "desktop/waybar-lib.sh",
	["waybar-toggle-smart.sh"] = "desktop/waybar-toggle-smart.sh",
}

function M.hypr()
	return hypr
end

function M.script(name)
	return hypr .. "/runtime/" .. (scripts[name] or name)
end

function M.runtime_script(name)
	return hypr .. "/runtime/" .. name
end

function M.asset(name)
	return hypr .. "/assets/" .. name
end

return M
