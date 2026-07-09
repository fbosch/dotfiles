local M = {}
local wezterm = require("wezterm")

local path_separator = package.config:sub(1, 1)
local function get_config_home()
	if type(wezterm.config_dir) == "string" and wezterm.config_dir ~= "" then
		local suffix = path_separator .. "wezterm"
		if wezterm.config_dir:sub(-#suffix) == suffix then
			return wezterm.config_dir:sub(1, #wezterm.config_dir - #suffix)
		end
	end

	return os.getenv("XDG_CONFIG_HOME") or ((os.getenv("HOME") or "") .. path_separator .. ".config")
end

local config_home = get_config_home()
local palette_path = config_home .. path_separator .. "fbb" .. path_separator .. "data" .. path_separator .. "palette.json"

local function read_palette()
	local file = assert(io.open(palette_path, "r"))
	local content = file:read("*a")
	file:close()
	local palette = wezterm.json_parse(content)
	assert(type(palette.zenwritten) == "table", "missing zenwritten palette")
	assert(type(palette.zenwritten.dark) == "table", "missing zenwritten dark palette")
	return palette.zenwritten.dark
end

local palette = read_palette()
local semantic = assert(palette.semantic, "missing zenwritten dark semantic palette")

M.base = {
	bg = palette.background,
	fg = palette.foreground,
	fg_active = "#b7b7b7",
	fg_muted = semantic.muted,
	separator = "#515151",
}

M.tab_bar = {
	background = palette.background,
	active_bg = "#262626",
	active_fg = "#b7b7b7",
	inactive_bg = "#191918",
	inactive_fg = semantic.muted,
}

M.agent = {
	working = "#8f9a72",
	waiting = "#c49f6f",
	idle = "#7f9b99",
	inactive = "#636363",
}

return M
