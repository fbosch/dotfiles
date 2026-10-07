local plugin_path = os.getenv("HYPR_POINTER_EDGE_HOOKS_PLUGIN")
if not plugin_path or plugin_path == "" then
	return
end

local ok, err = pcall(function()
	hl.plugin.load(plugin_path)
	hl.plugin.pointer_edge_hooks.start(20, 60)
end)

if not ok then
	io.stderr:write(
		"pointer-edge-hooks: plugin load failed; automatic Waybar edge positioning is disabled: ",
		tostring(err),
		"\n"
	)
end
