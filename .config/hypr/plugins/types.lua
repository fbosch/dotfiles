---@meta

---@alias HyprAdvancedBlendMode
---| "multiply"
---| "screen"
---| "overlay"
---| "darken"
---| "lighten"
---| "color-dodge"
---| "color-burn"
---| "hard-light"
---| "soft-light"
---| "difference"
---| "exclusion"
---| "hsl-hue"
---| "hsl-saturation"
---| "hsl-color"
---| "hsl-luminosity"

---@alias HyprInsetBorderBlendMode
---| "normal"
---| HyprAdvancedBlendMode

---@class AdaptiveSoftShadowConfig
---@field enabled? boolean
---@field range? integer
---@field render_power? integer
---@field offset? string
---@field strength? number
---@field active_strength? number
---@field inactive_strength? number
---@field color? string
---@field blend_mode? HyprAdvancedBlendMode

---@class InsetBorderConfig
---@field enabled? boolean
---@field thickness? integer
---@field inset? integer
---@field active_color? string
---@field inactive_color? string
---@field blend_mode? HyprInsetBorderBlendMode

return {}
