-- Base compositor settings ported from hyprland.conf.

hl.config({
  debug = {
    disable_logs = true,
    enable_stdout_logs = false,
  },
  xwayland = {
    force_zero_scaling = true,
  },
  opengl = {
    nvidia_anti_flicker = true,
  },
  render = {
    direct_scanout = false,
  },
})
