local wezterm = require("wezterm")

package.path = wezterm.config_dir .. "/../fbb/lua/?.lua;" .. package.path
local paths = require("fbb.paths")
local config_home = paths.config_home_from_app_dir(wezterm.config_dir, "wezterm")
return require("fbb.palette").zenwritten_dark(config_home, wezterm.json_parse)
