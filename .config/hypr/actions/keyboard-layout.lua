local async = require("lib.async")

local M = {}

M.switch = async.runtime_lua("desktop/switch-layout.lua")

return M
