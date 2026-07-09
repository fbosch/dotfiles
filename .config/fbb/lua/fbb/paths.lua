local M = {}

local separator = package.config:sub(1, 1)

---@param ... string|number
---@return string
function M.join(...)
	local path = tostring(select(1, ...))

	for i = 2, select("#", ...) do
		local part = tostring(select(i, ...))
		if part ~= "" then
			while part:sub(1, 1) == separator do
				part = part:sub(2)
			end
			if path:sub(-1) ~= separator then
				path = path .. separator
			end
			path = path .. part
		end
	end

	return path
end

---@return string
function M.config_home()
	return os.getenv("XDG_CONFIG_HOME") or M.join(os.getenv("HOME") or "", ".config")
end

---@param app_config_dir string|nil
---@param app_name string
---@return string
function M.config_home_from_app_dir(app_config_dir, app_name)
	if type(app_config_dir) ~= "string" or app_config_dir == "" then
		return M.config_home()
	end

	local suffix = separator .. app_name
	if app_config_dir:sub(-#suffix) == suffix then
		return app_config_dir:sub(1, #app_config_dir - #suffix)
	end

	return M.config_home()
end

---@param config_home? string
---@return string
function M.fbb_dir(config_home)
	return M.join(config_home or M.config_home(), "fbb")
end

---@param name string
---@param config_home? string
---@return string
function M.data_path(name, config_home)
	return M.join(M.fbb_dir(config_home), "data", name)
end

return M
