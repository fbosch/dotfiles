local plugin_path = os.getenv("HYPR_CUSTOM_LAYOUT_RESIZE_PLUGIN")

if not plugin_path then
	return
end

local ok, err = pcall(function()
	hl.plugin.load(plugin_path)
	-- Config reloads replace the Lua event handler without notifying loaded
	-- plugins; rebind re-fires the plugin event registration so hl.on
	-- subscriptions keep receiving commands.
	pcall(function()
		hl.plugin.custom_layout_resize.rebind()
	end)
end)

if not ok then
	io.stderr:write("custom-layout-resize: plugin load failed; custom layout drag resize is disabled: ", tostring(err), "\n")
end
