#!/usr/bin/env luajit

-- Shell-facing entry point for the single ags-ipc implementation. Keeps the
-- `ags_request <component> [payload]` contract so dash callers do not parse
-- busctl output themselves.

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")

local component = arg[1]
local payload = arg[2] or ""

if not component then
	io.stderr:write("usage: ags-request.lua <component> [payload]\n")
	os.exit(1)
end

print(ags_ipc.request(component, payload))
