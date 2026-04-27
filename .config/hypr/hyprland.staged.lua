-- Staged Hyprland Lua entrypoint.
-- Do not rename this file to hyprland.lua until the Lua config is ready to go live.

local loader = dofile(os.getenv("HOME") .. "/.config/hypr/lua/rule-loader.lua")

local result = loader.compile_rules({
  os.getenv("HOME") .. "/.config/hypr/lua/generated-rules.lua",
  os.getenv("HOME") .. "/.config/hypr/lua/rules.lua",
  os.getenv("HOME") .. "/.config/hypr/lua/window-state-rules.lua",
})

loader.report_warnings(result.warnings)
loader.log("compiled " .. tostring(#result.rules) .. " staged window rules")
