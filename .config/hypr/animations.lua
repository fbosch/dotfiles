-- Animations ported from animations.conf.

local M = {}

hl.config({
	animations = {
		enabled = true,
	},
})

hl.curve("window", { type = "spring", mass = 1, stiffness = 302, dampening = 34.8 })
hl.curve("windowQuick", { type = "spring", mass = 1, stiffness = 3780, dampening = 123 })
hl.curve("windowInstant", { type = "spring", mass = 1, stiffness = 14745, dampening = 242.9 })

local windows_move_animation = { leaf = "windowsMove", enabled = true, speed = 1.5, spring = "windowQuick" }

function M.restore_windows_move()
	hl.animation(windows_move_animation)
end

hl.animation({ leaf = "global", enabled = true, speed = 10, spring = "window" })
hl.animation({ leaf = "border", enabled = true, speed = 1.75, spring = "windowQuick" })
hl.animation({ leaf = "windows", enabled = true, speed = 4.79, spring = "window" })
M.restore_windows_move()
hl.animation({ leaf = "windowsIn", enabled = true, speed = 1.5, spring = "windowQuick", style = "popin 96%" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 0.8, spring = "windowInstant", style = "popin 94%" })
hl.animation({ leaf = "fadeIn", enabled = true, speed = 1.73, spring = "windowQuick" })
hl.animation({ leaf = "fadeOut", enabled = true, speed = 1.46, spring = "windowQuick" })
hl.animation({ leaf = "fade", enabled = true, speed = 3.03, spring = "windowQuick" })
hl.animation({ leaf = "fadeSwitch", enabled = true, speed = 2, spring = "windowQuick" })
hl.animation({ leaf = "workspaces", enabled = true, speed = 1.5, spring = "windowQuick", style = "slidefade 10%" })
hl.animation({ leaf = "workspacesIn", enabled = true, speed = 1.5, spring = "windowQuick", style = "slidefade 10%" })
hl.animation({ leaf = "workspacesOut", enabled = true, speed = 1.5, spring = "windowQuick", style = "slidefade 10%" })
hl.animation({ leaf = "specialWorkspace", enabled = true, speed = 1.5, spring = "windowQuick", style = "slidefadevert 10%" })
hl.animation({ leaf = "specialWorkspaceIn", enabled = true, speed = 1.5, spring = "windowQuick", style = "slidefadevert 10%" })
hl.animation({ leaf = "specialWorkspaceOut", enabled = true, speed = 1.5, spring = "windowQuick", style = "slidefadevert 10%" })
hl.animation({ leaf = "zoomFactor", enabled = true, speed = 7, spring = "window" })
hl.animation({ leaf = "fadeLayersIn", enabled = true, speed = 1.79, spring = "windowQuick" })
hl.animation({ leaf = "fadeLayersOut", enabled = true, speed = 1.39, spring = "windowQuick" })

-- Hyprland's Lua API currently exposes global animation leaves only. Keep these
-- namespace-specific hyprlang animations as a tracked gap until upstream exposes
-- an equivalent Lua shape:
-- animation = layersIn, ags-confirm, 1, 15, pop, popin 98%
-- animation = layersOut, ags-confirm, 1, 8, pop
-- animation = layersIn, ags-layout-switcher, 0
-- animation = layersOut, ags-layout-switcher, 0
-- animation = layersIn, ags-window-switcher, 0
-- animation = layersOut, ags-window-switcher, 0

hl.animation({ leaf = "layers", enabled = true, speed = 3.81, spring = "windowQuick" })
hl.animation({ leaf = "layersIn", enabled = true, speed = 4, spring = "windowQuick", style = "fade" })
hl.animation({ leaf = "layersOut", enabled = true, speed = 1.5, spring = "windowQuick", style = "fade" })

return M
