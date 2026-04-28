-- Input settings ported from input.conf.

hl.config({
  input = {
    kb_layout = "us,dk",
    kb_variant = "",
    kb_model = "",
    kb_options = "",
    kb_rules = "",
    repeat_rate = 40,
    repeat_delay = 400,
    follow_mouse = -1,
    float_switch_override_focus = 0,
    sensitivity = 0,
    touchpad = {
      natural_scroll = false,
    },
  },
  cursor = {
    no_warps = false,
  },
})

hl.gesture({
  fingers = 3,
  direction = "horizontal",
  action = "workspace",
})

hl.device({
  name = "epic-mouse-v1",
  sensitivity = -0.5,
})
