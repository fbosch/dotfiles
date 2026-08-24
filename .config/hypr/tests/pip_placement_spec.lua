local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pip_placement_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local placement = require("lib.pip_placement")
local pip = require("lib.picture_in_picture")

local function client(address, x, y, w, h, opts)
	opts = opts or {}
	return {
		address = address,
		monitor = opts.monitor or 0,
		at = { x, y },
		size = { w, h },
		floating = true,
		mapped = true,
		hidden = false,
		class = pip.class,
		title = pip.title,
		tags = opts.tags or {},
	}
end

local function monitor(name, id, x, y, w, h)
	return { name = name, id = tostring(id), x = x, y = y, width = w, height = h }
end

local monitors = { ultrawide = monitor("ultrawide", 0, 0, 0, 3440, 1440) }

local function input(now, event, overrides)
	overrides = overrides or {}
	return {
		now = now,
		event = event,
		clients = overrides.clients or {},
		monitors = overrides.monitors or monitors,
		bars = overrides.bars or {},
		active = overrides.active or {},
	}
end

local function of_kind(commands, kind)
	local matched = {}
	for _, cmd in ipairs(commands) do
		if cmd.kind == kind then
			matched[#matched + 1] = cmd
		end
	end
	return matched
end

-- Default bottom-right resting spot for a 400x225 window on the test monitor.
local rest_x, rest_y = 3440 - 400 - 15, 1440 - 225 - 15

it("snaps to the nearest corner on drag-end and tags it", function()
	local state = placement.new()
	local _, start_cmds = placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	assert.equal(0, #of_kind(start_cmds, "move"))

	local window = client("0x1", 2960, 1150, 400, 225)
	local _, cmds = placement.place(state, input(1, { type = "control", action = "drag-end" }, { clients = { window } }))

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(3025, moves[1].x)
	assert.equal(1200, moves[1].y)

	local tags = of_kind(cmds, "tag")
	assert.equal(1, #tags)
	assert.equal(pip.corners["bottom-right"].tag, tags[1].tag)
	assert.is_true(tags[1].add)

	local previews = of_kind(cmds, "preview")
	assert.equal(2, #previews)
	assert.is_table(previews[1].target)
	assert.is_nil(previews[2].target)
	local outlines = of_kind(cmds, "cursor-outline")
	assert.equal(2, #outlines)
	assert.is_true(outlines[1].enabled)
	assert.is_false(outlines[2].enabled)
end)

it("leaves windows alone beyond the snap vicinity", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local window = client("0x1", 1500, 600, 400, 225)
	local _, cmds = placement.place(state, input(1, { type = "control", action = "drag-end" }, { clients = { window } }))

	assert.equal(0, #of_kind(cmds, "move"))
	assert.equal(0, #of_kind(cmds, "tag"))
end)

it("lifts the resting spot above a visible waybar", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local bars = { ultrawide = { placement.rectangle(0, 1408, 3440, 32) } }
	local window = client("0x1", 2960, 1150, 400, 225)
	local _, cmds = placement.place(
		state,
		input(1, { type = "control", action = "drag-end" }, { clients = { window }, bars = bars })
	)

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(3025, moves[1].x)
	assert.equal(1168, moves[1].y)
end)

it("suppresses echo of its own moves during observation", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	local window = client("0x1", rest_x, rest_y, 400, 225)
	placement.place(state, input(1, { type = "control", action = "drag-end" }, { clients = { window } }))

	local _, cmds = placement.place(state, input(2, { type = "tick" }, { clients = { window } }))
	assert.equal(0, #of_kind(cmds, "move"))
end)

it("detects client-initiated drags and settles into a snap", function()
	local state = placement.new()
	local still = client("0x1", 1500, 600, 400, 225)
	placement.place(state, input(0, { type = "tick" }, { clients = { still } }))

	local moved = client("0x1", 2960, 1150, 400, 225)
	local _, cmds = placement.place(state, input(0.08, { type = "tick" }, { clients = { moved } }))
	assert.is_true(state.dragging)
	assert.equal("client", state.drag_source)
	assert.equal(0, #of_kind(cmds, "move"))

	-- Movement stops; the snap fires once the settle deadline passes.
	_, cmds = placement.place(state, input(0.3, { type = "tick" }, { clients = { moved } }))
	assert.is_false(state.dragging)

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(3025, moves[1].x)
	assert.equal(1200, moves[1].y)
end)

it("emits the snap preview once per distinct target", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local window = client("0x1", 2960, 1150, 400, 225)
	local snapshot = { clients = { window }, active = window }
	local _, first = placement.place(state, input(0, { type = "tick" }, snapshot))
	assert.equal(1, #of_kind(first, "preview"))

	local _, second = placement.place(state, input(0.08, { type = "tick" }, snapshot))
	assert.equal(0, #of_kind(second, "preview"))
	assert.equal(0, #of_kind(second, "cursor-outline"))
end)

it("restores the anchored corner after a resize", function()
	local state = placement.new()
	local before = client("0x1", 15, 1215, 400, 225, { tags = { "pip-bottom-left" } })
	placement.place(
		state,
		input(0, { type = "control", action = "resize-start" }, { active = before, clients = { before } })
	)
	assert.is_table(state.resize_anchor)

	local after = client("0x1", 200, 900, 800, 450, { tags = { "pip-bottom-left" } })
	local _, cmds = placement.place(
		state,
		input(1, { type = "control", action = "resize-end" }, { clients = { after } })
	)

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(15, moves[1].x)
	assert.equal(990, moves[1].y)
end)

it("reconciles newly opened pip windows onto their default corner", function()
	local state = placement.new()
	state.waybar_visible = false
	local _, cmds = placement.place(
		state,
		input(10, { type = "compositor", name = "openwindow", address = "0x9" })
	)
	assert.equal(0, #cmds)

	local window = client("0x9", rest_x, rest_y, 400, 225)
	_, cmds = placement.place(state, input(10.2, { type = "tick" }, { clients = { window } }))

	assert.equal(0, #of_kind(cmds, "move"))
	local tags = of_kind(cmds, "tag")
	assert.equal(1, #tags)
	assert.equal(pip.corners["bottom-right"].tag, tags[1].tag)
	assert.is_true(tags[1].add)
end)

it("moves a tagged window between corners on the move command", function()
	local state = placement.new()
	local window = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local _, cmds = placement.place(
		state,
		input(0, { type = "control", action = "move", address = "0x1", direction = "left" }, { clients = { window } })
	)

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(15, moves[1].x)
	assert.equal(1200, moves[1].y)

	local added, removed = {}, {}
	for _, cmd in ipairs(of_kind(cmds, "tag")) do
		if cmd.add then
			added[#added + 1] = cmd.tag
		else
			removed[#removed + 1] = cmd.tag
		end
	end
	assert.same({ pip.corners["bottom-left"].tag }, added)
	assert.same({ pip.corners["bottom-right"].tag }, removed)
end)
