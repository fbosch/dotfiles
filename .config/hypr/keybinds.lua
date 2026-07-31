local programs = require("programs")
local async = require("lib.async")
local bind = require("lib.bind")
local pip = require("lib.picture_in_picture")
local window = require("lib.window")
local gaming = require("gaming")
local volume = require("actions.volume")
local confirm_exit = require("actions.confirm-exit")
local clipboard_bridge = require("actions.clipboard-bridge")
local keyboard_layout = require("actions.keyboard-layout")
local picture_in_picture = require("actions.picture-in-picture")
local window_switcher = require("actions.window-switcher")

local main_mod = "SUPER"

local function main(key)
	return main_mod .. " + " .. key
end

local function with_active_window(identifier, on_match, on_miss)
	return function()
		local active = window.active()
		if active and active.class == identifier.class and active.title == identifier.title then
			local handled = on_match()
			if handled ~= false then
				return handled
			end
		end

		return on_miss()
	end
end

local function move_window_or_pip(direction)
	return with_active_window(pip, function() picture_in_picture.move_corner(direction) end, window.move(direction))
end

local function focus_window_or_pip(direction)
	return with_active_window(pip, function() picture_in_picture.focus(direction) end, window.focus(direction))
end

-- Window switching
bind.register(
	"SUPER_L",
	-- Keep the Waybar toggle out of the gaming workspace.
	"printf 'hold\\n' | nc -U \"$XDG_RUNTIME_DIR/hypr-waybar-monitor.sock\" >/dev/null 2>&1 || pkill -SIGUSR1 waybar",
	{ long_press = true, predicate = window.active_workspace_is_not(gaming.workspace), on_false = bind.consume }
)
bind.register("SUPER_L", window_switcher.release_super, { ignore_mods = true, release = true })
bind.register("SUPER_R", window_switcher.commit, { release = true })
bind.register(main("TAB"), window_switcher.action("next", main_mod))
bind.register(main("SHIFT + TAB"), window_switcher.action("prev", main_mod))

-- Launchers
bind.register(main("SPACE"), programs.menu)
bind.register(main("R"), programs.menu)

-- Input and clipboard
bind.register("CTRL + SPACE", keyboard_layout.switch, {
	predicate = window.active_is_not_game,
})
bind.register(main("SHIFT + V"), clipboard_bridge.paste_with_clipboard_bridge)
bind.register(
	"CTRL + C",
	clipboard_bridge.sync_wayland_to_xwayland,
	{ non_consuming = true, predicate = gaming.has_gamescope_window }
)
bind.register(
	"CTRL + X",
	clipboard_bridge.sync_wayland_to_xwayland,
	{ non_consuming = true, predicate = gaming.has_gamescope_window }
)
bind.register(
	"CTRL + V",
	clipboard_bridge.paste_with_clipboard_bridge,
	{ non_consuming = true, predicate = gaming.has_gamescope_window }
)

-- Desktop and session controls
bind.register(main("SHIFT + C"), "hyprpicker -a")
bind.register(main("N"), "swaync-client -t")
bind.register("CTRL + ALT + L", "hyprlock")
bind.register("PAUSE", "wl-freeze -a")
bind.register(main("SHIFT + P"), "~/.config/hypr/runtime/profiles/toggle-powersave-mode.sh")
bind.register(main("M"), confirm_exit.confirm_exit)
bind.register(main("SHIFT + R"), "~/.config/hypr/runtime/desktop/reset-desktop.sh")
bind.register(main("D"), "~/.config/hypr/runtime/windows/toggle-show-desktop.sh")

-- Gaming
bind.register(main("G"), window.focus_gaming_workspace)
bind.register(main("SHIFT + G"), window.move_to_gaming_workspace)

-- Capture
bind.register("CTRL + SHIFT + C", "bash ~/.config/hypr/runtime/capture/screenshot.sh area")
bind.register("PRINT", "bash ~/.config/hypr/runtime/capture/screenshot.sh screen", {
	non_consuming = true,
	ignore_mods = true,
	transparent = true,
	locked = true,
})
bind.register("CTRL + SHIFT + O", "bash ~/.config/hypr/runtime/capture/screenshot.sh ocr")

-- Applications
bind.register(main("Q"), programs.terminal)
bind.register(main("B"), function()
	for _, client in ipairs(hl.get_windows()) do
		if client.class == "app.zen_browser.zen" and (client.title or ""):match("^Extension:") == nil then
			hl.dispatch(hl.dsp.send_shortcut({ mods = "CTRL", key = "N", window = client }))
			return
		end
	end

	hl.dispatch(hl.dsp.exec_cmd(programs.browser))
end)
bind.register(main("E"), programs.file_manager)

-- Window state
bind.register(main("W"), async.runtime_lua("windows/killactive-selective.lua"))
bind.register(main("CTRL + C"), "~/.config/hypr/runtime/windows/confirm-hyprprop-kill.sh")
bind.register(main("V"), hl.dsp.window.float())
bind.register(main("P"), hl.dsp.window.pseudo())

bind.register(main("F"), hl.dsp.window.fullscreen({ mode = "maximized" }))
bind.register(main("CTRL + F"), hl.dsp.window.fullscreen({ mode = "fullscreen" }))
bind.register(main("CTRL + SHIFT + F"), hl.dsp.pass({ window = "class:^(xfreerdp)$" }))

bind.register(main("Z"), "~/.config/hypr/runtime/windows/minimized-state.lua toggle-window")
bind.register(main("SHIFT + Z"), "~/.config/hypr/runtime/windows/minimized-state.lua toggle-workspace")
bind.register(main("X"), window.hide_from_current_workspace)

-- Window focus and layout
bind.register(main("H"), focus_window_or_pip("left"))
bind.register(main("L"), focus_window_or_pip("right"))
bind.register(main("J"), focus_window_or_pip("down"))
bind.register(main("K"), focus_window_or_pip("up"))

bind.register(main("SHIFT + d"), hl.dsp.layout("setratio 0.6"))

-- Workspace selection
for workspace = 1, 10 do
	local workspace_name = tostring(workspace)
	local workspace_key = tostring(workspace % 10)
	bind.register(main(workspace_key), function()
		window.focus_workspace(workspace_name)
	end)
	bind.register(main("SHIFT + " .. workspace_key), function()
		window.move_to_workspace(workspace_name)
	end)
end

-- Workspace navigation
-- Both selectors are intentional: one advances each workspace family.
-- keybind-validator: allow-duplicate
bind.register(main("mouse_down"), hl.dsp.focus({ workspace = "e+1" }))
bind.register(main("mouse_up"), hl.dsp.focus({ workspace = "e-1" }))
bind.register(main("mouse_down"), hl.dsp.focus({ workspace = "m+1" }))
bind.register(main("mouse_up"), hl.dsp.focus({ workspace = "m-1" }))

hl.config({
	binds = {
		drag_threshold = 0,
	},
})

-- Custom layout controls
-- Current Lua mouse binds do not become native bindm entries, so custom layout
-- right-drag resize is bridged through a bounded IPC helper.
bind.register(main("mouse:272"), picture_in_picture.drag)
bind.register(main("mouse:272"), function()
	window.place_custom_layout_at_cursor()
	picture_in_picture.finish_drag()
end, { release = true })
bind.register(main("mouse:273"), function()
	if picture_in_picture.start_resize(false) == false then window.start_custom_layout_resize() end
end)
bind.register(main("mouse:273"), function()
	if picture_in_picture.finish_resize(false) == false then window.stop_custom_layout_resize() end
end, { release = true })
bind.register(main("SHIFT + mouse:273"), function()
	if picture_in_picture.start_resize(true) == false then window.resize_keep_aspect_ratio() end
end)
bind.register(main("SHIFT + mouse:273"), function()
	if picture_in_picture.finish_resize(true) == false then window.reset_keep_aspect_ratio() end
end, { release = true })
bind.register(main("SHIFT + H"), move_window_or_pip("left"))
bind.register(main("SHIFT + L"), move_window_or_pip("right"))
bind.register(main("SHIFT + J"), move_window_or_pip("down"))
bind.register(main("SHIFT + K"), move_window_or_pip("up"))

-- Window movement and resizing
bind.register(main("right"), window.adjust("nudge", "right"), { repeating = true })
bind.register(main("left"), window.adjust("nudge", "left"), { repeating = true })
bind.register(main("up"), window.adjust("nudge", "up"), { repeating = true })
bind.register(main("down"), window.adjust("nudge", "down"), { repeating = true })

bind.register(main("SHIFT + right"), window.adjust("resize", "right"), { repeating = true })
bind.register(main("SHIFT + left"), window.adjust("resize", "left"), { repeating = true })
bind.register(main("SHIFT + up"), window.adjust("resize", "up"), { repeating = true })
bind.register(main("SHIFT + down"), window.adjust("resize", "down"), { repeating = true })

-- Hardware controls
bind.register("XF86AudioRaiseVolume", volume.raise, { repeating = true, locked = true })
bind.register("XF86AudioLowerVolume", volume.lower, { repeating = true, locked = true })
bind.register("XF86AudioMute", volume.mute, { repeating = true, locked = true })
bind.register("XF86AudioMicMute", volume.mute_mic, { repeating = true, locked = true })
bind.register("XF86MonBrightnessUp", "brightnessctl -e4 -n2 set 5%+", { repeating = true, locked = true })
bind.register("XF86MonBrightnessDown", "brightnessctl -e4 -n2 set 5%-", { repeating = true, locked = true })
bind.register(main("CTRL + up"), volume.raise, { repeating = true, locked = true })
bind.register(main("CTRL + down"), volume.lower, { repeating = true, locked = true })
bind.register(main("CTRL + End"), volume.mute, { repeating = true, locked = true })
bind.register(main("CTRL + A"), volume.toggle_mixer)

-- Media controls
bind.register("XF86AudioNext", "playerctl next", { locked = true })
bind.register("XF86AudioPause", "playerctl play-pause", { locked = true })
bind.register("XF86AudioPlay", "playerctl play-pause", { locked = true })
bind.register("XF86AudioPrev", "playerctl previous", { locked = true })

bind.register(main("CTRL + left"), "playerctl previous", { locked = true })
bind.register(main("CTRL + right"), "playerctl next", { locked = true })
bind.register(main("CTRL + space"), "playerctl play-pause", { locked = true })
