local M = {}
local plugin_path = os.getenv("HYPR_CUSTOM_LAYOUT_POINTER_PLUGIN")

if
	plugin_path
	and plugin_path ~= ""
	and hl.plugin
	and type(hl.plugin.load) == "function"
then
	hl.plugin.load(plugin_path)
end

function M.api()
	local plugin = hl.plugin and hl.plugin.custom_layout_pointer
	if
		type(plugin) ~= "table"
		or type(plugin.start) ~= "function"
		or type(plugin.stop) ~= "function"
	then
		return nil
	end

	return plugin
end

function M.available()
	return M.api() ~= nil
end

return M
