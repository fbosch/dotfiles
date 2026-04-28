-- Look and feel ported from appearance.conf.

hl.config({
  general = {
    gaps_in = 2,
    gaps_out = 5,
    border_size = 2,
    col = {
      active_border = "rgba(ffffff73)",
      inactive_border = "rgba(ffffff1A)",
    },
    resize_on_border = true,
    extend_border_grab_area = 5,
    allow_tearing = false,
    layout = "dwindle",
  },
  layout = {
    single_window_aspect_ratio = "5.6 4",
    single_window_aspect_ratio_tolerance = 0.2,
  },
  decoration = {
    rounding = 8,
    rounding_power = 6.0,
    active_opacity = 1.0,
    inactive_opacity = 0.97,
    shadow = {
      enabled = true,
      range = 10,
      render_power = 8,
      color = "rgba(0000001A)",
      offset = "0 2",
      scale = 1.2,
    },
    blur = {
      enabled = true,
      size = 2,
      special = true,
      popups = true,
      passes = 4,
      ignore_opacity = false,
      new_optimizations = true,
      vibrancy = 0.1696,
    },
  },
  dwindle = {
    preserve_split = true,
  },
  master = {
    mfact = 0.67,
    new_status = "master",
  },
  scrolling = {
    column_width = 1.0,
    fullscreen_on_one_column = true,
  },
  misc = {
    vrr = false,
    force_default_wallpaper = -1,
    disable_hyprland_logo = true,
    disable_watchdog_warning = true,
    disable_splash_rendering = true,
    disable_hyprland_guiutils_check = true,
    mouse_move_focuses_monitor = true,
    initial_workspace_tracking = 0,
  },
})
