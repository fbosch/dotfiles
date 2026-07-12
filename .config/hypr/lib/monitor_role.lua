local M = {}

---@alias MonitorRole
---| "ultrawide"
---| "portrait"

---@type MonitorRole
M.ultrawide = "ultrawide"
---@type MonitorRole
M.portrait = "portrait"

-- Keep both maps aligned: roles_by_name[names_by_role[role]] must equal role.
---@type table<string, MonitorRole>
local roles_by_name = {
	["DP-2"] = M.ultrawide,
	["HDMI-A-2"] = M.portrait,
}

---@type table<MonitorRole, string>
local names_by_role = {
	[M.ultrawide] = "DP-2",
	[M.portrait] = "HDMI-A-2",
}

function M.for_name(name)
	return roles_by_name[name]
end

function M.for_monitor(monitor)
	return monitor and M.for_name(monitor.name) or nil
end

function M.for_window(window)
	return window and M.for_monitor(window.monitor) or nil
end

function M.name_for(role)
	return names_by_role[role]
end

return M
