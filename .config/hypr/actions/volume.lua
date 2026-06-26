local ags = require("lib.ags")

local M = {}

local function with_indicator(command)
	return hl.dsp.exec_cmd(command .. " && " .. ags.request_command("volume-indicator", { action = "show" }))
end

M.raise = with_indicator("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+")
M.lower = with_indicator("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-")
M.mute = with_indicator("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle")
M.mute_mic = hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle")
M.toggle_mixer = hl.dsp.exec_cmd(ags.request_command("audio-mixer-widget", { action = "toggle" }))

return M
