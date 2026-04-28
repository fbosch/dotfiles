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
  "uwsm-app -s b -- ~/.config/hypr/scripts/gamescope-profile-watchdog.sh",
  "uwsm-app -s b -- ~/.config/hypr/scripts/gamescope-clipboard-sync.sh",
  "~/.config/hypr/scripts/startup-desktop-ready.sh",
}

hl.on("hyprland.start", function()
  for _, command in ipairs(commands) do
    hl.exec_cmd(command)
  end
end)

return commands
