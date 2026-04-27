-- Keybindings ported from keybinds.conf.

local programs = dofile(os.getenv("HOME") .. "/.config/hypr/lua/programs.lua")

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

local function direction(value)
  return ({ l = "left", r = "right", u = "up", d = "down" })[value] or value
end

bind("bindo", "", "SUPER_L", exec("pkill -SIGUSR1 waybar"))
bind("bindir", "", "SUPER_L", exec("sleep 0.5 && ~/.config/hypr/scripts/waybar-toggle-smart.sh"))

bind("bind", "ALT", "SPACE", exec(programs.menu))
bind("bind", "ALT", "grave", exec("hyprwhspr-rs record start"))
bind("bindr", "ALT", "grave", exec("hyprwhspr-rs record stop"))

bind("bind", main_mod, "SPACE", exec("bash ~/.config/hypr/scripts/switch-layout.sh"))
bind("bind", main_mod .. " + SHIFT", "V", exec("bash ~/.config/hypr/scripts/paste-to-gamescope.sh"))
bind("bindn", "CTRL", "C", exec("bash ~/.config/hypr/scripts/paste-to-gamescope.sh"))
bind("bindn", "CTRL", "X", exec("bash ~/.config/hypr/scripts/paste-to-gamescope.sh"))

bind("bind", "ALT", "TAB", exec("bash ~/.config/hypr/scripts/window-switcher-wrapper.sh next"))
bind("bind", "ALT + SHIFT", "TAB", exec("bash ~/.config/hypr/scripts/window-switcher-wrapper.sh prev"))

bind("bind", main_mod .. " + SHIFT", "C", exec("hyprpicker -a"))
bind("bind", main_mod, "N", exec("swaync-client -t"))
bind("bind", "CTRL + ALT", "L", exec("hyprlock"))
bind("bind", main_mod .. " + SHIFT", "P", exec("~/.config/hypr/scripts/toggle-performance-mode.sh"))

bind("bind", "CTRL + SHIFT", "C", exec("bash ~/.config/hypr/scripts/screenshot.sh area"))
bind("bindnitl", "", "PRINT", exec("bash ~/.config/hypr/scripts/screenshot.sh screen"))
bind("bind", "CTRL + SHIFT", "O", exec("bash ~/.config/hypr/scripts/screenshot.sh ocr"))

bind("bind", main_mod, "Q", exec(programs.terminal))
bind("bind", main_mod, "B", exec(programs.browser))
bind("bind", main_mod, "C", exec("bash ~/.config/hypr/scripts/killactive-selective.sh"))
bind("bind", main_mod .. " + CTRL", "C", exec("bash ~/.config/hypr/scripts/confirm-hyprprop-kill.sh"))
bind("bind", main_mod, "M", exec("bash ~/.config/hypr/scripts/confirm-exit.sh"))
bind("bind", main_mod .. " + SHIFT", "R", exec("~/.config/hypr/scripts/reset-desktop.sh"))
bind("bind", main_mod, "E", exec(programs.file_manager))
bind("bind", main_mod, "V", hl.dsp.window.float())
bind("bind", main_mod, "R", exec(programs.menu))
bind("bind", main_mod, "P", hl.dsp.window.pseudo())

bind("bind", main_mod, "F", hl.dsp.window.fullscreen({ mode = "maximized" }))
bind("bind", main_mod .. " + CTRL", "F", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
bind("bind", main_mod, "F", hl.dsp.pass({ window = "class:^(xfreerdp)$" }))
bind("bind", main_mod, "W", exec("bash ~/.config/hypr/scripts/killactive-selective.sh"))
bind("bind", main_mod, "D", exec("~/.config/hypr/scripts/toggle-show-desktop.sh"))

bind("bind", main_mod, "Z", exec("~/.config/hypr/scripts/toggle-minimized-window.sh"))
bind("bind", main_mod .. " + SHIFT", "Z", exec("~/.config/hypr/scripts/toggle-minimized-workspace.sh"))
bind("bind", main_mod, "X", hl.dsp.window.move({ workspace = "+0", follow = false }))

bind("bind", main_mod, "H", hl.dsp.focus({ direction = direction("l") }))
bind("bind", main_mod, "L", hl.dsp.focus({ direction = direction("r") }))
bind("bind", main_mod, "J", hl.dsp.focus({ direction = direction("u") }))
bind("bind", main_mod, "K", hl.dsp.focus({ direction = direction("d") }))

bind("bind", main_mod .. " + SHIFT", "d", hl.dsp.layout("setratio 0.6"))

for workspace = 1, 10 do
  bind("bind", main_mod, tostring(workspace % 10), hl.dsp.focus({ workspace = tostring(workspace) }))
end

for workspace = 1, 10 do
  bind("bind", main_mod .. " + SHIFT", tostring(workspace % 10), hl.dsp.window.move({ workspace = tostring(workspace) }))
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

-- Upstream Lua example uses `{ mouse = true }`, but current source does not wire
-- opts.mouse into keybinds. Also, `resizewindow 1` has no Lua equivalent yet.
-- Keep these staged for future live testing after the Lua API matures.
bind("bindm", main_mod, "mouse:272", hl.dsp.window.drag())
bind("bindm", main_mod, "mouse:273", hl.dsp.window.resize())
bind("bindm", main_mod .. " + SHIFT", "mouse:273", hl.dsp.window.resize())

bind("bind", main_mod .. " + SHIFT", "H", hl.dsp.window.move({ direction = direction("l") }))
bind("bind", main_mod .. " + SHIFT", "L", hl.dsp.window.move({ direction = direction("r") }))
bind("bind", main_mod .. " + SHIFT", "J", hl.dsp.window.move({ direction = direction("u") }))
bind("bind", main_mod .. " + SHIFT", "K", hl.dsp.window.move({ direction = direction("d") }))

bind("binde", main_mod, "right", hl.dsp.window.move({ x = 32, y = 0, relative = true }))
bind("binde", main_mod, "left", hl.dsp.window.move({ x = -32, y = 0, relative = true }))
bind("binde", main_mod, "up", hl.dsp.window.move({ x = 0, y = -32, relative = true }))
bind("binde", main_mod, "down", hl.dsp.window.move({ x = 0, y = 32, relative = true }))

bind("binde", main_mod .. " + SHIFT", "right", hl.dsp.window.resize({ x = 32, y = 0, relative = true }))
bind("binde", main_mod .. " + SHIFT", "left", hl.dsp.window.resize({ x = -32, y = 0, relative = true }))
bind("binde", main_mod .. " + SHIFT", "up", hl.dsp.window.resize({ x = 0, y = -32, relative = true }))
bind("binde", main_mod .. " + SHIFT", "down", hl.dsp.window.resize({ x = 0, y = 32, relative = true }))

bind("bindel", "", "XF86AudioRaiseVolume", exec([[wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+ && ags request -i ags-bundled volume-indicator '{"action":"show"}']]))
bind("bindel", "", "XF86AudioLowerVolume", exec([[wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%- && ags request -i ags-bundled volume-indicator '{"action":"show"}']]))
bind("bindel", "", "XF86AudioMute", exec([[wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle && ags request -i ags-bundled volume-indicator '{"action":"show"}']]))
bind("bindel", "", "XF86AudioMicMute", exec("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"))
bind("bindel", "", "XF86MonBrightnessUp", exec("brightnessctl -e4 -n2 set 5%+"))
bind("bindel", "", "XF86MonBrightnessDown", exec("brightnessctl -e4 -n2 set 5%-"))

bind("bindl", "", "XF86AudioNext", exec("playerctl next"))
bind("bindl", "", "XF86AudioPause", exec("playerctl play-pause"))
bind("bindl", "", "XF86AudioPlay", exec("playerctl play-pause"))
bind("bindl", "", "XF86AudioPrev", exec("playerctl previous"))

bind("bindel", main_mod .. " + CTRL", "up", exec([[wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+ && ags request -i ags-bundled volume-indicator '{"action":"show"}']]))
bind("bindel", main_mod .. " + CTRL", "down", exec([[wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%- && ags request -i ags-bundled volume-indicator '{"action":"show"}']]))
bind("bindel", main_mod .. " + CTRL", "End", exec([[wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle && ags request -i ags-bundled volume-indicator '{"action":"show"}']]))

bind("bindl", main_mod .. " + CTRL", "left", exec("playerctl previous"))
bind("bindl", main_mod .. " + CTRL", "right", exec("playerctl next"))
bind("bindl", main_mod .. " + CTRL", "space", exec("playerctl play-pause"))

bind("bind", main_mod, "Escape", hl.dsp.submap("passthru"))
hl.define_submap("passthru", function()
  bind("bind", "SUPER", "Escape", hl.dsp.submap("reset"))
end)
