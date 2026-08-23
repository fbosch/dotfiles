-- Host-aware monitor rules.
-- Replaces generated, gitignored monitors.conf in the staged Lua config.

local system = require("lib.system")
local monitor_role = require("lib.monitor_role")
local host = system.hostname()

if host == "rvn-pc" then
	hl.monitor({
		output = monitor_role.name_for(monitor_role.ultrawide),
		mode = "3440x1440@164.9",
		position = "1440x500",
		scale = 1.0,
		-- 10 bpc causes flickering black bars in the XWayland WoW client.
		bitdepth = 8,
		-- cm = "hdr",
		-- sdr_eotf = "srgb",
		-- sdrbrightness = 5,
		-- sdrsaturation = 1,
	})

	hl.monitor({
		output = monitor_role.name_for(monitor_role.portrait),
		mode = "2560x1440@59.95",
		position = "0x0",
		scale = 1.0,
		transform = 3,
	})
else
	hl.monitor({
		output = "",
		mode = "preferred",
		position = "auto",
		scale = 1.0,
	})
end
