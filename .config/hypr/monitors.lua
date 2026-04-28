-- Host-aware monitor rules.
-- Replaces generated, gitignored monitors.conf in the staged Lua config.

local system = require("lib.system")
local host = system.hostname()

if host == "rvn-pc" then
	hl.monitor({
		output = "DP-2",
		mode = "3440x1440@164.9",
		position = "1440x477",
		scale = 1.0,
		-- bitdepth = 10,
		-- TODO: investigate why HDR is not working and how to configure monitor positions in graphical interface
		-- cm = "hdr",
	})

	hl.monitor({
		output = "HDMI-A-2",
		mode = "2560x1440@59.95",
		position = "0x0",
		scale = 1.0,
	})

	hl.monitor({
		output = "HDMI-A-2",
		transform = 3,
	})
end

hl.monitor({
	output = "",
	mode = "preferred",
	position = "auto",
	scale = 1,
})

return {
	host = host,
}
