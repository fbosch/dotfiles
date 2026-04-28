#!/usr/bin/env lua

local config_dir = (os.getenv("HOME") or "") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local monitor_gate = require("lua.startup.monitor_gate")

monitor_gate.wait()
