local json = require("lib.json")

local M = {
	class = "app.zen_browser.zen",
	title = "Picture-in-Picture",
	margin = 15,
	overlap_gap = 15,
	snap_vicinity = 100,
	rounding = 8,
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

M.corner_moves = {
	["top-left"] = string.format("%d %d", M.margin, M.margin),
	["top-right"] = string.format("(monitor_w-window_w-%d) %d", M.margin, M.margin),
	["bottom-left"] = string.format("%d (monitor_h-window_h-%d)", M.margin, M.margin),
	["bottom-right"] = string.format("(monitor_w-window_w-%d) (monitor_h-window_h-%d)", M.margin, M.margin),
}

M.normal_move = M.corner_moves["bottom-right"]

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

M.acceptance = {
	action = "accept-pip-placement-v1",
}

local function finite_number(value)
	return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

function M.acceptance.normalize(value)
	if type(value) ~= "table" or type(value.target_monitor) ~= "string" or value.target_monitor == "" then
		return nil, "expected target_monitor"
	end

	if value.kind == "corner" and M.corners[value.corner] then
		return {
			kind = "corner",
			corner = value.corner,
			target_monitor = value.target_monitor,
		}
	end

	if value.kind == "free" and finite_number(value.x) and finite_number(value.y) then
		return {
			kind = "free",
			target_monitor = value.target_monitor,
			x = value.x,
			y = value.y,
		}
	end

	return nil, "expected corner or free placement"
end

function M.acceptance.encode(value)
	local normalized, err = M.acceptance.normalize(value)
	assert(normalized, err)
	return M.acceptance.action .. " " .. json.encode(normalized)
end

function M.acceptance.decode(line)
	if type(line) ~= "string" then
		return nil, "expected placement command"
	end

	local action, payload = line:match("^(%S+)%s+(.+)$")
	if action ~= M.acceptance.action then
		return nil, "unknown placement command"
	end

	return M.acceptance.normalize(json.object(payload))
end

function M.register_window_rules()
	hl.window_rule({
		match = { title = "^([Pp]icture-in-[Pp]icture)$" },
		float = true,
		no_initial_focus = true,
		pin = true,
		content = "video",
		suppress_event = "maximize",
		size = { 640, 360 },
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
