local M = {}

local home = os.getenv("HOME")
local hypr = home .. "/.config/hypr"

function M.hypr()
	return hypr
end

function M.script(name)
	return hypr .. "/scripts/" .. name
end

function M.runtime_script(name)
	return hypr .. "/lua/runtime/" .. name
end

function M.asset(name)
	return hypr .. "/assets/" .. name
end

return M
