local plugin_path = os.getenv("HYPR_CUSTOM_LAYOUT_RESIZE_PLUGIN")

if not plugin_path then
	return
end

local ok, err = pcall(function()
	hl.plugin.load(plugin_path)
end)

if not ok then
	io.stderr:write("custom-layout-resize: plugin load failed; custom layout drag resize is disabled: ", tostring(err), "\n")
end
