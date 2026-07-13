#!/usr/bin/env lua

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local gaming = require("rules.gaming")
local window = json.object(io.read("*a"))

if
	gaming.requires_close_confirmation({
		class = window.class,
		initial_class = window.initialClass,
		title = window.title,
		initial_title = window.initialTitle,
	})
then
	os.exit(0)
end

os.exit(1)
