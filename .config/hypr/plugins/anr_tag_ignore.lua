local window_tags = require("lib.window_tags")

local plugin_path = os.getenv("HYPR_ANR_TAG_IGNORE_PLUGIN")

if not plugin_path or plugin_path == "" then
	-- A system switch updates this path before the existing Hyprland session receives new environment variables.
	plugin_path = "/run/current-system/sw/lib/libanr-tag-ignore.so"
	local plugin_file = io.open(plugin_path, "r")
	if not plugin_file then
		return
	end
	plugin_file:close()
end

local function is_loaded()
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == "anr-tag-ignore" then
			return true
		end
	end

	return false
end

local ok, err = pcall(function()
	hl.plugin.load(plugin_path)

	if not is_loaded() then
		-- Plugin loading schedules a reload; this parse still uses the old config schema.
		return
	end

	hl.config({
		plugin = {
			anr_tag_ignore = {
				ignored_tags = window_tags.intentionally_frozen,
			},
		},
	})
end)

if not ok then
	io.stderr:write(
		"anr-tag-ignore: plugin load failed; intentionally frozen clients may show ANR dialogs: ",
		tostring(err),
		"\n"
	)
end
