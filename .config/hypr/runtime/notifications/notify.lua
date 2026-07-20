#!/usr/bin/env lua

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local notify = require("lib.notify")
local level = arg[1]

if level ~= "error" then
	io.stderr:write("usage: notify.lua error <key> <summary> <body>\n")
	os.exit(1)
end

notify.error(arg[2] or "unknown", arg[3] or "Hyprland error", arg[4] or "")
