local plugin_path = os.getenv("HYPR_CURSOR_OUTLINE_PLUGIN")

if not plugin_path then
	return
end

hl.plugin.load(plugin_path)

hl.config({
	plugin = {
		cursor_outline = {
			thickness = 3,
			-- AARRGGBB: Zenwritten accent primary at 96% opacity.
			color = 0xF56099C0,
		},
	},
})
