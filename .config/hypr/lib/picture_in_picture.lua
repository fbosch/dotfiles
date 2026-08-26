local M = {
	class = "app.zen_browser.zen",
	title = "Picture-in-Picture",
	margin = 15,
	overlap_gap = 15,
	snap_vicinity = 100,
	rounding = 8,
	default_animation = "slide bottom",
	corners = {
		["top-left"] = { tag = "pip-top-left", animation = "slide top" },
		["top-right"] = { tag = "pip-top-right", animation = "slide top" },
		["bottom-left"] = { tag = "pip-bottom-left", animation = "slide bottom" },
		["bottom-right"] = { tag = "pip-bottom-right", animation = "slide bottom" },
	},
}

M.corner_tag_animations = {}
for _, corner in pairs(M.corners) do
	M.corner_tag_animations[corner.tag] = corner.animation
end

M.normal_move = string.format("(monitor_w-window_w-%d) (monitor_h-window_h-%d)", M.margin, M.margin)

function M.matches(window)
	return window ~= nil and window.class == M.class and window.title == M.title
end

-- Control protocol for pip-monitor.sock. Single owner of the wire format:
-- senders encode, the daemon decodes. One line per command.
M.control = {}

---@param action string Command name, e.g. "drag-start" or "waybar-show".
---@param address? string Target window address.
---@param direction? string Corner direction; only valid with the "move" action.
---@return string line
function M.control.encode(action, address, direction)
	if action == "move" and direction and address then
		return table.concat({ action, direction, address }, " ")
	elseif address then
		return action .. " " .. address
	end
	return action
end

---@return string? action
---@return string? address
---@return string? direction Only set for the "move" action.
function M.control.decode(line)
	if type(line) ~= "string" or line == "" then
		return nil
	end

	local action, rest = line:match("^(%S+)%s*(.*)$")
	rest = rest ~= "" and rest or nil

	if action == "move" and rest then
		local direction, address = rest:match("^(%S+)%s+(%S+)$")
		if direction then
			return action, address, direction
		end
	end

	return action, rest
end

function M.register_window_rules()
	hl.window_rule({
		match = { title = "^([Pp]icture-in-[Pp]icture)$" },
		float = true,
		no_initial_focus = true,
		pin = true,
		content = "video",
		persistent_size = true,
		rounding = M.rounding,
	})
	hl.window_rule({ match = { title = "([Pp]icture-in-[Pp]icture)" }, animation = M.default_animation })
	for _, corner in pairs(M.corners) do
		hl.window_rule({ match = { tag = corner.tag }, animation = corner.animation })
	end
	hl.window_rule({
		match = { initial_title = "(^(Picture-in-Picture)$)" },
		move = M.normal_move,
	})
end

return M
