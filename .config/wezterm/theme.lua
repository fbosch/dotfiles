local M = {}
local wezterm = require("wezterm")

package.path = wezterm.config_dir .. "/../fbb/lua/?.lua;" .. package.path
local paths = require("fbb.paths")
local config_home = paths.config_home_from_app_dir(wezterm.config_dir, "wezterm")
local palette, _, semantic = require("fbb.palette").zenwritten_dark(config_home, wezterm.json_parse)

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
