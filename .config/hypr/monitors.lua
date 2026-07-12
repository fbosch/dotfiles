-- Host-aware monitor rules.
-- Replaces generated, gitignored monitors.conf in the staged Lua config.

local system = require("lib.system")
local host = system.hostname()

if host == "rvn-pc" then
	hl.monitor({
		output = "DP-2",
		mode = "3440x1440@164.9",
		position = "1440x500",
		scale = 1.0,
		bitdepth = 10,
		-- cm = "hdr",
		-- sdr_eotf = "srgb",
		-- sdrbrightness = 5,
		-- sdrsaturation = 1,
	})

	hl.monitor({
		output = "HDMI-A-2",
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
