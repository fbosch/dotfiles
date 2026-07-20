-- Keybindings ported from keybinds.conf.

local programs = require("programs")
local async = require("lib.async")
local window = require("lib.window")
local volume = require("actions.volume")
local confirm_exit = require("actions.confirm-exit")
local clipboard_bridge = require("actions.clipboard-bridge")
local keyboard_layout = require("actions.keyboard-layout")
local window_switcher = require("actions.window-switcher")

local main_mod = "SUPER"

hl.bind("SUPER_L", function()
	if hl.get_active_workspace().name == "10" then
		return
	end

	hl.dispatch(hl.dsp.exec_cmd("pkill -SIGUSR1 waybar"))
end, { long_press = true })
hl.bind("SUPER_L", window_switcher.release_super, { ignore_mods = true, release = true })
hl.bind("SUPER_R", window_switcher.commit, { release = true })

hl.bind(main_mod .. " + SPACE", hl.dsp.exec_cmd(programs.menu))

keyboard_layout.bind()
hl.bind(main_mod .. " + SHIFT + V", clipboard_bridge.paste_with_clipboard_bridge)
hl.bind("CTRL + C", clipboard_bridge.sync_wayland_to_xwayland, { non_consuming = true })
hl.bind("CTRL + X", clipboard_bridge.sync_wayland_to_xwayland, { non_consuming = true })
hl.bind("CTRL + V", clipboard_bridge.paste_with_clipboard_bridge, { non_consuming = true })

hl.bind(main_mod .. " + TAB", window_switcher.action("next", main_mod))
hl.bind(main_mod .. " + SHIFT + TAB", window_switcher.action("prev", main_mod))

hl.bind(main_mod .. " + SHIFT + C", hl.dsp.exec_cmd("hyprpicker -a"))
hl.bind(main_mod .. " + N", hl.dsp.exec_cmd("swaync-client -t"))
hl.bind("CTRL + ALT + L", hl.dsp.exec_cmd("hyprlock"))
hl.bind("PAUSE", hl.dsp.exec_cmd("wl-freeze -a"))
hl.bind(main_mod .. " + SHIFT + P", hl.dsp.exec_cmd("~/.config/hypr/runtime/profiles/toggle-powersave-mode.sh"))
hl.bind(main_mod .. " + G", hl.dsp.exec_cmd("~/.config/hypr/runtime/windows/focus-gaming-workspace.lua"))
hl.bind(main_mod .. " + SHIFT + G", window.move_to_gaming_workspace)

hl.bind("CTRL + SHIFT + C", hl.dsp.exec_cmd("bash ~/.config/hypr/runtime/capture/screenshot.sh area"))
hl.bind("PRINT", hl.dsp.exec_cmd("bash ~/.config/hypr/runtime/capture/screenshot.sh screen"), {
	non_consuming = true,
	ignore_mods = true,
	transparent = true,
	locked = true,
})
hl.bind("CTRL + SHIFT + O", hl.dsp.exec_cmd("bash ~/.config/hypr/runtime/capture/screenshot.sh ocr"))

hl.bind(main_mod .. " + Q", hl.dsp.exec_cmd(programs.terminal))
hl.bind(main_mod .. " + B", function()
	for _, client in ipairs(hl.get_windows()) do
		if client.class == "app.zen_browser.zen" and (client.title or ""):match("^Extension:") == nil then
			hl.dispatch(hl.dsp.send_shortcut({ mods = "CTRL", key = "N", window = client }))
			return
		end
	end

	hl.dispatch(hl.dsp.exec_cmd(programs.browser))
end)
hl.bind(main_mod .. " + W", async.runtime_lua("windows/killactive-selective.lua"))
hl.bind(main_mod .. " + CTRL + C", hl.dsp.exec_cmd("~/.config/hypr/runtime/windows/confirm-hyprprop-kill.sh"))
hl.bind(main_mod .. " + M", confirm_exit.confirm_exit)
hl.bind(main_mod .. " + SHIFT + R", hl.dsp.exec_cmd("~/.config/hypr/runtime/desktop/reset-desktop.sh"))
hl.bind(main_mod .. " + E", hl.dsp.exec_cmd(programs.file_manager))
hl.bind(main_mod .. " + V", hl.dsp.window.float())
hl.bind(main_mod .. " + R", hl.dsp.exec_cmd(programs.menu))
hl.bind(main_mod .. " + P", hl.dsp.window.pseudo())

hl.bind(main_mod .. " + F", hl.dsp.window.fullscreen({ mode = "maximized" }))
hl.bind(main_mod .. " + CTRL + F", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
hl.bind(main_mod .. " + CTRL + SHIFT + F", hl.dsp.pass({ window = "class:^(xfreerdp)$" }))
hl.bind(main_mod .. " + D", hl.dsp.exec_cmd("~/.config/hypr/runtime/windows/toggle-show-desktop.sh"))

hl.bind(main_mod .. " + Z", hl.dsp.exec_cmd("~/.config/hypr/runtime/windows/minimized-state.lua toggle-window"))
hl.bind(
	main_mod .. " + SHIFT + Z",
	hl.dsp.exec_cmd("~/.config/hypr/runtime/windows/minimized-state.lua toggle-workspace")
)
hl.bind(main_mod .. " + X", window.hide_from_current_workspace)

hl.bind(main_mod .. " + H", window.focus("left"))
hl.bind(main_mod .. " + L", window.focus("right"))
hl.bind(main_mod .. " + J", window.focus("down"))
hl.bind(main_mod .. " + K", window.focus("up"))

hl.bind(main_mod .. " + SHIFT + d", hl.dsp.layout("setratio 0.6"))

for workspace = 1, 10 do
	local workspace_name = tostring(workspace)
	hl.bind(main_mod .. " + " .. tostring(workspace % 10), function()
		window.focus_workspace(workspace_name)
	end)
end

for workspace = 1, 10 do
	local workspace_name = tostring(workspace)
	hl.bind(main_mod .. " + SHIFT + " .. tostring(workspace % 10), function()
		window.move_to_workspace(workspace_name)
	end)
end

hl.bind(main_mod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }))
hl.bind(main_mod .. " + mouse_up", hl.dsp.focus({ workspace = "e-1" }))
hl.bind(main_mod .. " + mouse_down", hl.dsp.focus({ workspace = "m+1" }))
hl.bind(main_mod .. " + mouse_up", hl.dsp.focus({ workspace = "m-1" }))

hl.config({
	binds = {
		drag_threshold = 0,
	},
})

-- Current Lua mouse binds do not become native bindm entries, so custom layout
-- right-drag resize is bridged through a bounded IPC helper.
hl.bind(main_mod .. " + mouse:272", hl.dsp.window.drag())
hl.bind(main_mod .. " + mouse:272", window.place_custom_layout_at_cursor, { release = true })
hl.bind(main_mod .. " + mouse:273", window.start_custom_layout_resize)
hl.bind(main_mod .. " + mouse:273", window.stop_custom_layout_resize, { release = true })
hl.bind(main_mod .. " + SHIFT + mouse:273", window.resize_keep_aspect_ratio)
hl.bind(main_mod .. " + SHIFT + mouse:273", window.reset_keep_aspect_ratio, { release = true })
hl.bind(main_mod .. " + SHIFT + H", window.move("left"))
hl.bind(main_mod .. " + SHIFT + L", window.move("right"))
hl.bind(main_mod .. " + SHIFT + J", window.move("down"))
hl.bind(main_mod .. " + SHIFT + K", window.move("up"))

hl.bind(main_mod .. " + right", window.adjust("nudge", "right"), { repeating = true })
hl.bind(main_mod .. " + left", window.adjust("nudge", "left"), { repeating = true })
hl.bind(main_mod .. " + up", window.adjust("nudge", "up"), { repeating = true })
hl.bind(main_mod .. " + down", window.adjust("nudge", "down"), { repeating = true })

hl.bind(main_mod .. " + SHIFT + right", window.adjust("resize", "right"), { repeating = true })
hl.bind(main_mod .. " + SHIFT + left", window.adjust("resize", "left"), { repeating = true })
hl.bind(main_mod .. " + SHIFT + up", window.adjust("resize", "up"), { repeating = true })
hl.bind(main_mod .. " + SHIFT + down", window.adjust("resize", "down"), { repeating = true })

hl.bind("XF86AudioRaiseVolume", volume.raise, { repeating = true, locked = true })
hl.bind("XF86AudioLowerVolume", volume.lower, { repeating = true, locked = true })
hl.bind("XF86AudioMute", volume.mute, { repeating = true, locked = true })
hl.bind("XF86AudioMicMute", volume.mute_mic, { repeating = true, locked = true })
hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%+"), { repeating = true, locked = true })
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 5%-"), { repeating = true, locked = true })

hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), { locked = true })
hl.bind("XF86AudioPause", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), { locked = true })

hl.bind(main_mod .. " + CTRL + up", volume.raise, { repeating = true, locked = true })
hl.bind(main_mod .. " + CTRL + down", volume.lower, { repeating = true, locked = true })
hl.bind(main_mod .. " + CTRL + End", volume.mute, { repeating = true, locked = true })
hl.bind(main_mod .. " + CTRL + A", volume.toggle_mixer)

hl.bind(main_mod .. " + CTRL + left", hl.dsp.exec_cmd("playerctl previous"), { locked = true })
hl.bind(main_mod .. " + CTRL + right", hl.dsp.exec_cmd("playerctl next"), { locked = true })
hl.bind(main_mod .. " + CTRL + space", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })

hl.bind(main_mod .. " + Escape", hl.dsp.submap("passthru"))
hl.define_submap("passthru", function()
	hl.bind("SUPER + Escape", hl.dsp.submap("reset"))
end)
