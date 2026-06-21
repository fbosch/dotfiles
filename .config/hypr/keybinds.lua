-- Keybindings ported from keybinds.conf.

local programs = require("programs")
local window = require("lib.window")
local volume = require("actions.volume")
local ags = require("lib.ags")
local confirm_exit = require("actions.confirm-exit")
local clipboard_bridge = require("actions.clipboard-bridge")
local window_switcher = require("actions.window-switcher")

local main_mod = "SUPER"

local opts = {
	bindo = { long_press = true },
	bindir = { ignore_mods = true, release = true },
	bindr = { release = true },
	bindn = { non_consuming = true },
	bindnitl = { non_consuming = true, ignore_mods = true, transparent = true, locked = true },
	binde = { repeating = true },
	bindel = { repeating = true, locked = true },
	bindl = { locked = true },
	bindm = { mouse = true },
	bindmr = { mouse = true, release = true },
	bindmn = { mouse = true, non_consuming = true },
}

local function key(mods, name)
	if mods == "" then
		return name
	end

	return mods .. " + " .. name
end

local function bind(kind, mods, name, dispatcher)
	hl.bind(key(mods, name), dispatcher, opts[kind])
end

local function exec(command)
	return hl.dsp.exec_cmd(command)
end

local waybar_toggle_smart = exec("sleep 0.5 && ~/.config/hypr/runtime/desktop/waybar-toggle-smart.sh")

local function super_release()
	window_switcher.commit()
	hl.dispatch(waybar_toggle_smart)
end

local function send_to_gaming_workspace()
	hl.dispatch(hl.dsp.window.move({ workspace = "10" }))
end

local function pin_workspace_one()
	hl.dispatch(hl.dsp.workspace.move({ workspace = "1", monitor = "HDMI-A-2" }))
end

local function focus_workspace(workspace)
	if workspace == "1" then
		pin_workspace_one()
		hl.dispatch(hl.dsp.focus({ monitor = "HDMI-A-2" }))
	end

	hl.dispatch(hl.dsp.focus({ workspace = workspace }))
end

local function move_to_workspace(workspace)
	if workspace == "1" then
		pin_workspace_one()
	end

	hl.dispatch(hl.dsp.window.move({ workspace = workspace }))
end

local function custom_layout_resize(action)
	return exec(
		"~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh " .. action
	)
end

local function resize_keep_aspect_ratio()
	hl.dispatch(custom_layout_resize("stop"))
	hl.dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	hl.dispatch(hl.dsp.window.resize())
end

local function reset_keep_aspect_ratio()
	hl.dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
end

local function start_custom_layout_resize()
	reset_keep_aspect_ratio()
	hl.dispatch(custom_layout_resize("start"))
end

local function drag_openpets()
	local active = hl.get_active_window()

	if active and active.title == "OpenPets Default Pet" then
		hl.dispatch(hl.dsp.window.drag())
	end
end

bind("bindo", "", "SUPER_L", exec("pkill -SIGUSR1 waybar"))
bind("bindir", "", "SUPER_L", super_release)
bind("bindr", "", "SUPER_R", window_switcher.commit)

bind("bind", main_mod, "SPACE", exec(programs.menu))
bind("bind", "ALT", "grave", exec("~/.config/hypr/runtime/capture/hyprwhspr-record.sh start"))
bind("bindr", "ALT", "grave", exec("~/.config/hypr/runtime/capture/hyprwhspr-record.sh stop"))

bind("bind", "ALT", "SPACE", exec("bash ~/.config/hypr/runtime/desktop/switch-layout.sh"))
bind("bind", main_mod .. " + SHIFT", "V", clipboard_bridge.paste_with_clipboard_bridge)
bind("bindn", "CTRL", "C", clipboard_bridge.sync_wayland_to_xwayland)
bind("bindn", "CTRL", "X", clipboard_bridge.sync_wayland_to_xwayland)
bind("bindn", "CTRL", "V", clipboard_bridge.paste_with_clipboard_bridge)

bind("bind", main_mod, "TAB", window_switcher.action("next", main_mod))
bind("bind", main_mod .. " + SHIFT", "TAB", window_switcher.action("prev", main_mod))

bind("bind", main_mod .. " + SHIFT", "C", exec("hyprpicker -a"))
bind("bind", main_mod, "N", exec("swaync-client -t"))
bind("bind", "CTRL + ALT", "L", exec("hyprlock"))
bind("bind", "", "PAUSE", exec("wl-freeze -a"))
bind("bind", main_mod .. " + SHIFT", "P", exec("~/.config/hypr/runtime/profiles/toggle-powersave-mode.sh"))
bind("bind", main_mod, "G", exec("~/.config/hypr/runtime/windows/focus-gaming-workspace.lua"))
bind("bind", main_mod .. " + SHIFT", "G", send_to_gaming_workspace)

bind("bind", "CTRL + SHIFT", "C", exec("bash ~/.config/hypr/runtime/capture/screenshot.sh area"))
bind("bindnitl", "", "PRINT", exec("bash ~/.config/hypr/runtime/capture/screenshot.sh screen"))
bind("bind", "CTRL + SHIFT", "O", exec("bash ~/.config/hypr/runtime/capture/screenshot.sh ocr"))

bind("bind", main_mod, "Q", exec(programs.terminal))
bind("bind", main_mod, "B", exec(programs.browser))
bind("bind", main_mod, "W", exec("~/.config/hypr/runtime/windows/killactive-selective.sh"))
bind("bind", main_mod .. " + CTRL", "C", exec("~/.config/hypr/runtime/windows/confirm-hyprprop-kill.sh"))
bind("bind", main_mod, "M", confirm_exit.confirm_exit)
bind("bind", main_mod .. " + SHIFT", "R", exec("~/.config/hypr/runtime/desktop/reset-desktop.sh"))
bind("bind", main_mod, "E", exec(programs.file_manager))
bind("bind", main_mod, "V", hl.dsp.window.float())
bind("bind", main_mod, "R", exec(programs.menu))
bind("bind", main_mod, "P", hl.dsp.window.pseudo())

bind("bind", main_mod, "F", hl.dsp.window.fullscreen({ mode = "maximized" }))
bind("bind", main_mod .. " + CTRL", "F", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
bind("bind", main_mod .. " + CTRL + SHIFT", "F", hl.dsp.pass({ window = "class:^(xfreerdp)$" }))
bind("bind", main_mod, "D", exec("~/.config/hypr/runtime/windows/toggle-show-desktop.sh"))

bind("bind", main_mod, "Z", exec("~/.config/hypr/runtime/windows/minimized-state.lua toggle-window"))
bind("bind", main_mod .. " + SHIFT", "Z", exec("~/.config/hypr/runtime/windows/minimized-state.lua toggle-workspace"))
bind("bind", main_mod, "X", function()
	hl.dispatch(hl.dsp.window.move({ workspace = "+0", follow = false }))
end)

bind("bind", main_mod, "H", window.focus("left"))
bind("bind", main_mod, "L", window.focus("right"))
bind("bind", main_mod, "J", window.focus("down"))
bind("bind", main_mod, "K", window.focus("up"))

bind("bind", main_mod .. " + SHIFT", "d", hl.dsp.layout("setratio 0.6"))

for workspace = 1, 10 do
	bind("bind", main_mod, tostring(workspace % 10), function()
		focus_workspace(tostring(workspace))
	end)
end

for workspace = 1, 10 do
	bind("bind", main_mod .. " + SHIFT", tostring(workspace % 10), function()
		move_to_workspace(tostring(workspace))
	end)
end

bind("bind", main_mod, "mouse_down", hl.dsp.focus({ workspace = "e+1" }))
bind("bind", main_mod, "mouse_up", hl.dsp.focus({ workspace = "e-1" }))
bind("bind", main_mod, "mouse_down", hl.dsp.focus({ workspace = "m+1" }))
bind("bind", main_mod, "mouse_up", hl.dsp.focus({ workspace = "m-1" }))

hl.config({
	binds = {
		drag_threshold = 0,
	},
})

-- Current Lua mouse binds do not become native bindm entries, so custom layout
-- right-drag resize is bridged through a bounded IPC helper.
bind("bind", main_mod, "mouse:272", hl.dsp.window.drag())
bind("bindr", main_mod, "mouse:272", hl.dsp.layout("place-at-cursor"))
bind("bind", main_mod, "mouse:273", start_custom_layout_resize)
bind("bindr", main_mod, "mouse:273", custom_layout_resize("stop"))
bind("bind", main_mod .. " + SHIFT", "mouse:273", resize_keep_aspect_ratio)
bind("bindr", main_mod .. " + SHIFT", "mouse:273", reset_keep_aspect_ratio)
bind("bindmn", "", "mouse:272", drag_openpets)

bind("bind", main_mod .. " + SHIFT", "H", window.move("left"))
bind("bind", main_mod .. " + SHIFT", "L", window.move("right"))
bind("bind", main_mod .. " + SHIFT", "J", window.move("down"))
bind("bind", main_mod .. " + SHIFT", "K", window.move("up"))

bind("binde", main_mod, "right", window.adjust("nudge", "right"))
bind("binde", main_mod, "left", window.adjust("nudge", "left"))
bind("binde", main_mod, "up", window.adjust("nudge", "up"))
bind("binde", main_mod, "down", window.adjust("nudge", "down"))

bind("binde", main_mod .. " + SHIFT", "right", window.adjust("resize", "right"))
bind("binde", main_mod .. " + SHIFT", "left", window.adjust("resize", "left"))
bind("binde", main_mod .. " + SHIFT", "up", window.adjust("resize", "up"))
bind("binde", main_mod .. " + SHIFT", "down", window.adjust("resize", "down"))

bind("bindel", "", "XF86AudioRaiseVolume", volume.raise)
bind("bindel", "", "XF86AudioLowerVolume", volume.lower)
bind("bindel", "", "XF86AudioMute", volume.mute)
bind("bindel", "", "XF86AudioMicMute", volume.mute_mic)
bind("bindel", "", "XF86MonBrightnessUp", exec("brightnessctl -e4 -n2 set 5%+"))
bind("bindel", "", "XF86MonBrightnessDown", exec("brightnessctl -e4 -n2 set 5%-"))

bind("bindl", "", "XF86AudioNext", exec("playerctl next"))
bind("bindl", "", "XF86AudioPause", exec("playerctl play-pause"))
bind("bindl", "", "XF86AudioPlay", exec("playerctl play-pause"))
bind("bindl", "", "XF86AudioPrev", exec("playerctl previous"))

bind("bindel", main_mod .. " + CTRL", "up", volume.raise)
bind("bindel", main_mod .. " + CTRL", "down", volume.lower)
bind("bindel", main_mod .. " + CTRL", "End", volume.mute)
bind("bind", main_mod .. " + CTRL", "A", exec(ags.request_command("audio-mixer-widget", { action = "toggle" })))

bind("bindl", main_mod .. " + CTRL", "left", exec("playerctl previous"))
bind("bindl", main_mod .. " + CTRL", "right", exec("playerctl next"))
bind("bindl", main_mod .. " + CTRL", "space", exec("playerctl play-pause"))

bind("bind", main_mod, "Escape", hl.dsp.submap("passthru"))
hl.define_submap("passthru", function()
	bind("bind", "SUPER", "Escape", hl.dsp.submap("reset"))
end)
