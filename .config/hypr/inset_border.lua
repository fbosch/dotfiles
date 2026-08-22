local plugin_path = os.getenv("HYPR_INSET_BORDER_PLUGIN")

if not plugin_path then
	return
end

hl.plugin.load(plugin_path)

hl.config({
	plugin = {
		inset_border = {
			enabled = true,
			thickness = 1,
			inset = 0,
			active_color = 0x73FFFFFF,
			inactive_color = 0x1AFFFFFF,
		},
	},
})
