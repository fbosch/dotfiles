local plugin = require("plugins.transient_placement")

local M = {}

---@type TransientPlacementRule[]
local rules = {
	{
		parent_class = "app.zen_browser.zen",
		child_class = "app.zen_browser.zen-popup",
		infer_focused_parent = true,
		no_anim = true,
	},
	{
		parent_class = "helium",
		child_class = "helium-popup",
		infer_focused_parent = true,
		no_anim = true,
	},
	{
		parent_class = "nemo",
		child_class = "zenity",
		infer_focused_parent = true,
		no_anim = true,
	},
	{
		parent_class = "nemo",
		child_class = "org.gnome.FileRoller",
		infer_focused_parent = true,
		no_anim = true,
	},
	{
		parent_class = "nemo",
		child_class = "org.gnome.Loupe",
		infer_focused_parent = true,
		no_anim = true,
	},
	{
		parent_class = "md.obsidian.Obsidian",
		child_class = "md.obsidian.Obsidian",
		child_title_prefixes = { "Settings - ", "Community plugins - " },
		infer_focused_parent = true,
		no_anim = true,
	},
}

function M.register()
	hl.window_rule({
		match = {
			class = "^md\\.obsidian\\.Obsidian$",
			initial_title = "^(Settings|Community plugins) - .*$",
		},
		float = true,
		size = "970 1050",
		no_anim = true,
	})
	return plugin.configure(rules)
end

return M
