local async = require("lib.async")
local gaming = require("gaming")
local state = require("lib.window.state")

local M = {}
local dispatch = hl.dispatch
local warp_active_after_focus = async.runtime_lua("windows/warp-cursor-to-active-window.lua", "--delay", "0.03")
local pinned_workspace = "1"
local pinned_workspace_monitor = "HDMI-A-2"

local function pin_workspace_one()
	dispatch(hl.dsp.workspace.move({ workspace = pinned_workspace, monitor = pinned_workspace_monitor }))
end

function M.focus_gaming_workspace()
	local target
	for _, client in ipairs(hl.get_windows()) do
		local workspace = client.workspace
		local name = workspace and tostring(workspace.name or workspace.id) or ""
		if name == gaming.workspace then
			if state.is_game(client) then
				target = client
				break
			end

			target = target or client
		end
	end

	if target == nil then
		return false
	end

	dispatch(hl.dsp.focus({ window = target }))
	dispatch(warp_active_after_focus)
	return true
end

function M.focus_workspace(workspace)
	if workspace == pinned_workspace then
		pin_workspace_one()
		dispatch(hl.dsp.focus({ monitor = pinned_workspace_monitor }))
	end

	dispatch(hl.dsp.focus({ workspace = workspace }))
end

function M.move_to_workspace(workspace)
	if workspace == pinned_workspace then
		pin_workspace_one()
	end

	dispatch(hl.dsp.window.move({ workspace = workspace }))
end

function M.move_to_gaming_workspace()
	M.move_to_workspace(gaming.workspace)
	dispatch(hl.dsp.window.fullscreen({ mode = "fullscreen" }))
end

function M.hide_from_current_workspace()
	dispatch(hl.dsp.window.move({ workspace = "+0", follow = false }))
end

return M
