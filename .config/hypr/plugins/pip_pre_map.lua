local pip = require("lib.picture_in_picture")

local function is_loaded()
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == "pip-pre-map" then
			return true
		end
	end

	return false
end

local function resolve_plugin_path()
	local plugin_path = os.getenv("HYPR_PIP_PRE_MAP_PLUGIN")
	if plugin_path and plugin_path ~= "" then
		return plugin_path
	end

	-- A system switch updates this path before the existing Hyprland session receives new environment variables.
	plugin_path = "/run/current-system/sw/lib/libpip-pre-map.so"
	local plugin_file = io.open(plugin_path, "r")
	if not plugin_file then
		return nil
	end
	plugin_file:close()
	return plugin_path
end

local ok, err = pcall(function()
	if not is_loaded() then
		local plugin_path = resolve_plugin_path()
		if not plugin_path then
			return
		end
		hl.plugin.load(plugin_path)
	end

	if not is_loaded() then
		-- Plugin loading schedules a reload; this parse still uses the old config schema.
		return
	end

	hl.config({
		plugin = {
			pip_pre_map = {
				app_ids = table.concat(pip.pip_classes, ","),
			},
		},
	})
end)

if not ok then
	io.stderr:write("pip-pre-map: plugin load failed; browser PiP may open at tiled size: " .. tostring(err) .. "\n")
end
