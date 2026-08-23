-- Keep config reloads working when the compositor lacks NixOS session variables.
local plugin_path = os.getenv("HYPR_INSET_BORDER_PLUGIN") or "/run/current-system/sw/lib/libinset-border.so"

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
			active_color = "rgba(ffffff66)",
			inactive_color = "rgba(ffffff33)",
		},
	},
})
