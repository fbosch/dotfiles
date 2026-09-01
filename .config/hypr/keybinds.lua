local programs = require("programs")
local async = require("lib.async")
local bind = require("lib.bind")
local mouse_release = require("lib.mouse_release").new(bind)
local window_tags = require("lib.window_tags")
local window_custom_layout = require("lib.window.custom_layout")
local window_directional = require("lib.window.directional")
local pointer_interaction = require("lib.window.pointer").new()
local window_state = require("lib.window.state")
local window_workspace = require("lib.window.workspace")
local gaming = require("gaming")
local volume = require("actions.volume")
local confirm_exit = require("actions.confirm-exit")
local clipboard_bridge = require("actions.clipboard-bridge")
local keyboard_layout = require("actions.keyboard-layout")
local ai_pointer = require("actions.ai-pointer")
local toggle_powersave_mode = require("actions.toggle-powersave-mode")
local pip = require("lib.picture_in_picture")
local window_switcher = require("actions.window-switcher")
local waybar = require("actions.waybar")

local main_mod = "SUPER"
local active_is_not_passthrough_exempt = window_state.active_is_not_tagged(window_tags.passthrough_exempt)
local waybar_hold_allowed = window_state.active_workspace_is_not(gaming.workspace)

local function main(key)
	return main_mod .. " + " .. key
end

local function focus_gaming_workspace()
	return window_workspace.focus_gaming_workspace()
end

local function release_super()
	mouse_release.finish_all()
	ai_pointer.consume_super_chord()
	return window_switcher.release_super()
end

local function release_super_right()
	mouse_release.finish_all()
	return window_switcher.commit()
end

local function release_mouse_modifier()
	if mouse_release.finish_all() then
		return bind.consume()
	end

	return bind.pass()
end

-- Window switching
bind.register(
	main("SUPER_L"),
	-- Keep the Waybar toggle out of the gaming workspace.
	waybar.hold,
	{
		long_press = true,
		predicate = function()
			return ai_pointer.has_super_chord() == false and waybar_hold_allowed()
		end,
		on_false = bind.consume,
	}
)
bind.register(main("SUPER_L"), release_super, { release = true })
bind.register(main("SUPER_R"), release_super_right, { release = true })
bind.register(main("TAB"), window_switcher.action("next", main_mod))
bind.register(main("SHIFT + TAB"), window_switcher.action("prev", main_mod))

-- Launchers
bind.register(main("SPACE"), programs.menu)
bind.register(main("R"), programs.menu)
mouse_release.bind(main("mouse:274"), function()
	if ai_pointer.start() then
		return ai_pointer.finish
	end
end)
bind.register("ALT + ALT_L", release_mouse_modifier, { release = true, auto_consuming = true })
bind.register("ALT + ALT_R", release_mouse_modifier, { release = true, auto_consuming = true })

-- Input and clipboard
bind.register("CTRL + SPACE", keyboard_layout.switch, {
	predicate = window_state.active_is_not_game,
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
bind.register(main("SHIFT + P"), toggle_powersave_mode.toggle_powersave_mode)
bind.register(main("M"), confirm_exit.confirm_exit)
bind.register(main("SHIFT + R"), "~/.config/hypr/runtime/desktop/reset-desktop.sh")
bind.register(main("D"), "~/.config/hypr/runtime/windows/toggle-show-desktop.sh")

-- Gaming
bind.register(main("G"), focus_gaming_workspace)
bind.register(main("SHIFT + G"), window_workspace.move_to_gaming_workspace)

-- Capture
bind.register("CTRL + SHIFT + C", "bash ~/.config/hypr/runtime/capture/screenshot.sh clipboard")
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
		if
			client.class == pip.class
			and client.title ~= pip.title
			and (client.title or ""):match("^Extension:") == nil
		then
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
bind.register(main("V"), function()
	return window_custom_layout.toggle_float()
end, {
	predicate = active_is_not_passthrough_exempt,
})
bind.register(main("P"), hl.dsp.window.pseudo(), {
	predicate = active_is_not_passthrough_exempt,
})

bind.register(main("F"), hl.dsp.window.fullscreen({ mode = "maximized" }), {
	predicate = active_is_not_passthrough_exempt,
})
bind.register(main("CTRL + F"), hl.dsp.window.fullscreen({ mode = "fullscreen" }), {
	predicate = active_is_not_passthrough_exempt,
})
bind.register(main("CTRL + SHIFT + F"), hl.dsp.pass({ window = "class:^(xfreerdp)$" }), {
	predicate = active_is_not_passthrough_exempt,
})

bind.register(main("Z"), "~/.config/hypr/runtime/windows/minimized-state.lua toggle-window")
bind.register(main("SHIFT + Z"), "~/.config/hypr/runtime/windows/minimized-state.lua toggle-workspace")
bind.register(main("X"), window_workspace.hide_from_current_workspace)

-- Window focus and layout
bind.register(main("H"), window_directional.focus("left"))
bind.register(main("L"), window_directional.focus("right"))
bind.register(main("J"), window_directional.focus("down"))
bind.register(main("K"), window_directional.focus("up"))

bind.register(main("SHIFT + d"), hl.dsp.layout("setratio 0.6"))

-- Workspace selection
for workspace = 1, 10 do
	local workspace_name = tostring(workspace)
	local workspace_key = tostring(workspace % 10)
	bind.register(main(workspace_key), function()
		window_workspace.focus_workspace(workspace_name)
	end)
	bind.register(main("SHIFT + " .. workspace_key), function()
		window_workspace.move_to_workspace(workspace_name)
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
-- Hyprland owns the pressed-input release event; the pointer router keeps one
-- target identity and interaction owner from press through release.
mouse_release.bind(main("mouse:272"), pointer_interaction.start_drag)
mouse_release.bind(main("mouse:273"), function()
	return pointer_interaction.start_resize(false)
end)
mouse_release.bind(main("SHIFT + mouse:273"), function()
	return pointer_interaction.start_resize(true)
end)
bind.register("SHIFT + SHIFT_L", release_mouse_modifier, { release = true, auto_consuming = true })
bind.register("SHIFT + SHIFT_R", release_mouse_modifier, { release = true, auto_consuming = true })
bind.register(main("SHIFT + H"), window_directional.move("left"))
bind.register(main("SHIFT + L"), window_directional.move("right"))
bind.register(main("SHIFT + J"), window_directional.move("down"))
bind.register(main("SHIFT + K"), window_directional.move("up"))

-- Window movement and resizing
bind.register(main("right"), window_directional.adjust("nudge", "right"), { repeating = true })
bind.register(main("left"), window_directional.adjust("nudge", "left"), { repeating = true })
bind.register(main("up"), window_directional.adjust("nudge", "up"), { repeating = true })
bind.register(main("down"), window_directional.adjust("nudge", "down"), { repeating = true })

bind.register(main("SHIFT + right"), window_directional.adjust("resize", "right"), { repeating = true })
bind.register(main("SHIFT + left"), window_directional.adjust("resize", "left"), { repeating = true })
bind.register(main("SHIFT + up"), window_directional.adjust("resize", "up"), { repeating = true })
bind.register(main("SHIFT + down"), window_directional.adjust("resize", "down"), { repeating = true })

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
