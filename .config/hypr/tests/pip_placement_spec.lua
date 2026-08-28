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

local function accepted_placements(commands)
	local placements = {}
	for _, command in ipairs(of_kind(commands, "accept-placement")) do
		placements[#placements + 1] = command.placement
	end
	return placements
end

-- Default bottom-right resting spot for a 400x225 window on the test monitor.
local rest_x, rest_y = 3440 - 400 - 15, 1440 - 225 - 15

it("snaps to the nearest corner on drag-end and tags it", function()
	local state = placement.new()
	local _, start_cmds = placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	assert.equal(0, #of_kind(start_cmds, "move"))

	local window = client("0x1", 2960, 1150, 400, 225)
	local _, held_cmds = placement.place(state, input(0.3, { type = "tick" }, { clients = { window } }))
	assert.is_true(state.dragging)
	assert.equal(0, #of_kind(held_cmds, "move"))
	assert.is_table(of_kind(held_cmds, "preview")[1].target)
	assert.is_true(of_kind(held_cmds, "cursor-outline")[1].enabled)

	local _, cmds =
		placement.place(state, input(1, { type = "control", action = "drag-end" }, { clients = { window } }))

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(3025, moves[1].x)
	assert.equal(1200, moves[1].y)

	local tags = of_kind(cmds, "tag")
	assert.equal(1, #tags)
	assert.equal(pip.corners["bottom-right"].tag, tags[1].tag)
	assert.is_true(tags[1].add)

	local previews = of_kind(cmds, "preview")
	assert.equal(1, #previews)
	assert.is_nil(previews[1].target)
	local outlines = of_kind(cmds, "cursor-outline")
	assert.equal(1, #outlines)
	assert.is_false(outlines[1].enabled)
end)

it("snaps when released exactly at the snap-vicinity boundary", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local window = client("0x1", 3440 - 400 - pip.snap_vicinity, 1440 - 225 - pip.snap_vicinity, 400, 225)
	local _, cmds =
		placement.place(state, input(1, { type = "control", action = "drag-end" }, { clients = { window } }))

	assert.equal(1, #of_kind(cmds, "move"))
	assert.equal(pip.corners["bottom-right"].tag, of_kind(cmds, "tag")[1].tag)
end)

it("leaves windows alone beyond the snap vicinity", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local window = client("0x1", 1500, 600, 400, 225)
	local _, cmds =
		placement.place(state, input(1, { type = "control", action = "drag-end" }, { clients = { window } }))

	assert.equal(0, #of_kind(cmds, "move"))
	assert.equal(0, #of_kind(cmds, "tag"))
end)

it("accepts an explicit router drag-end free placement immediately when no correction is needed", function()
	local state = placement.new()
	local window = client("0x1", 1500, 600, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local _, commands =
		placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { window } }))

	assert.equal(0, #of_kind(commands, "move"))
	assert.same(
		{ { kind = "free", target_monitor = "ultrawide", x = 1500, y = 600, width = 400, height = 225 } },
		accepted_placements(commands)
	)
end)

it("accepts a snapped router drag-end only after observing its exact position and tag", function()
	local state = placement.new()
	local dragged = client("0x1", 2960, 1150, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local _, corrected =
		placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { dragged } }))
	assert.equal(0, #accepted_placements(corrected))

	local observed = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local _, accepted = placement.place(state, input(0.2, { type = "tick" }, { clients = { observed } }))
	assert.same(
		{ { kind = "corner", corner = "bottom-right", target_monitor = "ultrawide", width = 400, height = 225 } },
		accepted_placements(accepted)
	)
end)

it("accepts free placement after the bare corner tag clears while the old dynamic rule tag remains", function()
	local state = placement.new()
	local dragged = client("0x1", 1500, 600, 400, 225, { tags = { "pip-top-left", "pip-top-left*" } })
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))

	local _, clearing =
		placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { dragged } }))
	assert.equal(0, #accepted_placements(clearing))

	local observed = client("0x1", 1500, 600, 400, 225, { tags = { "pip-top-left*" } })
	local _, accepted = placement.place(state, input(0.2, { type = "tick" }, { clients = { observed } }))
	assert.same(
		{ { kind = "free", target_monitor = "ultrawide", x = 1500, y = 600, width = 400, height = 225 } },
		accepted_placements(accepted)
	)
end)

it("drops corrected router drag-end placement after the 500ms observation deadline", function()
	local state = placement.new()
	local dragged = client("0x1", 2960, 1150, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { dragged } }))

	local _, commands = placement.place(state, input(0.6, { type = "tick" }, { clients = { dragged } }))
	assert.equal(0, #accepted_placements(commands))
	assert.equal(1, #of_kind(commands, "acceptance-timeout"))
end)

it("keeps corrected placement pending across config reloads and empty observations", function()
	local state = placement.new()
	local dragged = client("0x1", 2960, 1150, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { dragged } }))

	placement.place(state, input(0.15, { type = "configreload" }))
	placement.place(state, input(0.2, { type = "tick" }))
	assert.is_not_nil(state.pending_acceptance)
	assert.is_true(state.next_observation_at < math.huge)

	local observed = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local _, accepted = placement.place(state, input(0.3, { type = "tick" }, { clients = { observed } }))
	assert.same(
		{ { kind = "corner", corner = "bottom-right", target_monitor = "ultrawide", width = 400, height = 225 } },
		accepted_placements(accepted)
	)
end)

it("does not accept pending placement from derived startup or waybar events", function()
	local state = placement.new()
	local dragged = client("0x1", 2960, 1150, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { dragged } }))
	local observed = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })

	local _, startup = placement.place(state, input(0.2, { type = "startup" }, { clients = { observed } }))
	local _, waybar =
		placement.place(state, input(0.3, { type = "control", action = "waybar-hide" }, { clients = { observed } }))

	assert.equal(0, #accepted_placements(startup))
	assert.equal(0, #accepted_placements(waybar))
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

it("ignores direct client movement and sleeps while no router interaction is active", function()
	local state = placement.new()
	local still = client("0x1", 1500, 600, 400, 225)
	local _, initial = placement.place(state, input(0, { type = "tick" }, { clients = { still } }))
	assert.is_false(state.dragging)
	assert.equal(math.huge, state.next_observation_at)
	assert.equal(0, #initial)

	local moved = client("0x1", 2960, 1150, 400, 225)
	local _, cmds = placement.place(state, input(0.08, { type = "tick" }, { clients = { moved } }))
	assert.is_false(state.dragging)
	assert.equal(math.huge, state.next_observation_at)
	assert.equal(0, #of_kind(cmds, "move"))
	assert.equal(0, #accepted_placements(cmds))
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

it("limits drag sampling to the configured observation cadence", function()
	local state = placement.new()
	local window = client("0x1", 2960, 1150, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	assert.is_true(placement.tick_due(state, 0))

	placement.place(state, input(0, { type = "tick" }, { clients = { window }, active = window }))
	assert.is_false(placement.tick_due(state, placement.drag_interval_s - 0.001))
	assert.is_true(placement.tick_due(state, placement.drag_interval_s))
end)

it("restores the anchored corner after a resize", function()
	local state = placement.new()
	local before = client("0x1", 15, 1215, 400, 225, { tags = { "pip-bottom-left" } })
	placement.place(
		state,
		input(0, { type = "control", action = "resize-start", address = "0x1" }, { clients = { before } })
	)
	assert.is_table(state.resize_anchor)

	local after = client("0x1", 200, 900, 800, 450, { tags = { "pip-bottom-left" } })
	local _, cmds =
		placement.place(state, input(1, { type = "control", action = "resize-end" }, { clients = { after } }))

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(15, moves[1].x)
	assert.equal(990, moves[1].y)
	assert.equal(0, #accepted_placements(cmds))

	local observed = client("0x1", 15, 990, 800, 450, { tags = { "pip-bottom-left" } })
	local _, accepted = placement.place(state, input(1.1, { type = "tick" }, { clients = { observed } }))
	assert.same(
		{ { kind = "corner", corner = "bottom-left", target_monitor = "ultrawide", width = 800, height = 450 } },
		accepted_placements(accepted)
	)
end)

it("clears resize state when release target revalidation fails", function()
	local state = placement.new()
	local before = client("0x1", 15, 1215, 400, 225, { tags = { "pip-bottom-left" } })
	placement.place(
		state,
		input(0, { type = "control", action = "resize-start", address = "0x1" }, { clients = { before } })
	)
	assert.is_table(state.resize_anchor)

	local _, cmds = placement.place(state, input(1, { type = "control", action = "resize-cancel" }))
	assert.is_nil(state.resize_anchor)
	assert.is_nil(state.resizing_address)
	assert.equal(0, #of_kind(cmds, "move"))
end)

it("suppresses resize reconciliation throughout a free manual resize", function()
	local state = placement.new()
	local before = client("0x1", 1200, 600, 400, 225)
	placement.place(state, input(-0.1, { type = "compositor", name = "resizewindow", address = "0x1" }))
	assert.equal(0, state.reconcile_at)
	assert.is_false(state.reconcile_addresses["0x1"])

	placement.place(
		state,
		input(0, { type = "control", action = "resize-start", address = "0x1" }, { clients = { before } })
	)
	assert.equal("0x1", state.resizing_address)
	assert.is_nil(state.resize_anchor)
	assert.is_nil(state.reconcile_at)
	assert.same({}, state.reconcile_addresses)

	placement.place(state, input(0.05, { type = "compositor", name = "resizewindow", address = "0x1" }))
	assert.is_nil(state.reconcile_at)
	assert.same({}, state.reconcile_addresses)

	local after = client("0x1", 1200, 600, 800, 450)
	local _, commands =
		placement.place(state, input(0.1, { type = "control", action = "resize-end" }, { clients = { after } }))
	assert.is_nil(state.resizing_address)
	assert.same(
		{ { kind = "free", target_monitor = "ultrawide", x = 1200, y = 600, width = 800, height = 450 } },
		accepted_placements(commands)
	)
end)

it("reconciles newly opened pip windows onto their default corner", function()
	local state = placement.new()
	state.waybar_visible = false
	local _, cmds = placement.place(state, input(10, { type = "compositor", name = "openwindow", address = "0x9" }))
	assert.equal(0, #cmds)

	local window = client("0x9", rest_x, rest_y, 400, 225)
	_, cmds = placement.place(state, input(10.2, { type = "tick" }, { clients = { window } }))

	assert.equal(0, #of_kind(cmds, "move"))
	local tags = of_kind(cmds, "tag")
	assert.equal(1, #tags)
	assert.equal(pip.corners["bottom-right"].tag, tags[1].tag)
	assert.is_true(tags[1].add)
end)

it("repositions tagged PiP windows after monitor geometry changes", function()
	local state = placement.new()
	local resized_monitors = { ultrawide = monitor("ultrawide", 0, 0, 0, 2560, 1080) }
	local window = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local _, cmds = placement.place(
		state,
		input(0, { type = "monitorchange" }, { clients = { window }, monitors = resized_monitors })
	)

	local moves = of_kind(cmds, "move")
	assert.equal(1, #moves)
	assert.equal(2145, moves[1].x)
	assert.equal(840, moves[1].y)
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
	assert.equal(0, #accepted_placements(cmds))

	local observed = client("0x1", 15, 1200, 400, 225, { tags = { "pip-bottom-right*", "pip-bottom-left" } })
	local _, accepted = placement.place(state, input(0.1, { type = "tick" }, { clients = { observed } }))
	assert.same(
		{ { kind = "corner", corner = "bottom-left", target_monitor = "ultrawide", width = 400, height = 225 } },
		accepted_placements(accepted)
	)
end)

it("clears drag state and preview without snapping when a drag is cancelled", function()
	local state = placement.new()
	local window = client("0x1", 2960, 1150, 400, 225)
	placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
	placement.place(state, input(0.08, { type = "tick" }, { clients = { window }, active = window }))

	local _, commands = placement.place(state, input(0.1, { type = "control", action = "drag-cancel" }))

	assert.is_false(state.dragging)
	assert.is_nil(state.dragging_address)
	assert.equal(math.huge, state.next_observation_at)
	assert.equal(0, #of_kind(commands, "move"))
	assert.is_nil(of_kind(commands, "preview")[1].target)
	assert.is_false(of_kind(commands, "cursor-outline")[1].enabled)
end)

it("places tagged PiP windows according to waybar visibility at startup", function()
	local bar = { ultrawide = { placement.rectangle(0, 1408, 3440, 32) } }
	local state = placement.new({ waybar_visible = true })
	local resting = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local _, shown = placement.place(state, input(0, { type = "startup" }, { clients = { resting }, bars = bar }))

	assert.same({ { kind = "move", address = "0x1", x = rest_x, y = 1168 } }, of_kind(shown, "move"))

	local avoided = client("0x1", rest_x, 1168, 400, 225, { tags = { "pip-bottom-right" } })
	local hidden_state = placement.new()
	local _, hidden =
		placement.place(hidden_state, input(1, { type = "startup" }, { clients = { avoided }, bars = bar }))

	assert.same({ { kind = "move", address = "0x1", x = rest_x, y = rest_y } }, of_kind(hidden, "move"))
end)

it("sets waybar visibility and only moves PiP windows that need each geometry transition", function()
	local state = placement.new()
	local bar = { ultrawide = { placement.rectangle(0, 1408, 3440, 32) } }
	local bottom = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local _, shown = placement.place(
		state,
		input(0, { type = "control", action = "waybar-show" }, { clients = { bottom }, bars = bar })
	)

	assert.is_true(state.waybar_visible)
	assert.same({ { kind = "move", address = "0x1", x = rest_x, y = 1168 } }, of_kind(shown, "move"))

	local top = client("0x2", 15, 15, 400, 225, { tags = { "pip-top-left" } })
	local _, unchanged = placement.place(
		state,
		input(1, { type = "control", action = "waybar-show" }, { clients = { top }, bars = bar })
	)
	assert.equal(0, #of_kind(unchanged, "move"))

	local avoided = client("0x1", rest_x, 1168, 400, 225, { tags = { "pip-bottom-right" } })
	local _, hidden = placement.place(
		state,
		input(2, { type = "control", action = "waybar-hide" }, { clients = { avoided }, bars = bar })
	)
	assert.is_false(state.waybar_visible)
	assert.same({ { kind = "move", address = "0x1", x = rest_x, y = rest_y } }, of_kind(hidden, "move"))
end)

it("schedules resize reconciliation unless the PiP is being dragged or resized", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "compositor", name = "resizewindow", address = "0x1" }))
	assert.equal(0.1, state.reconcile_at)
	assert.is_false(state.reconcile_addresses["0x1"])

	placement.place(state, input(0.05, { type = "control", action = "drag-start", address = "0x1" }))
	assert.is_nil(state.reconcile_at)
	assert.same({}, state.reconcile_addresses)
	placement.place(state, input(0.06, { type = "compositor", name = "resizewindow", address = "0x2" }))
	assert.is_nil(state.reconcile_addresses["0x2"])

	local tagged = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	placement.place(state, input(0.07, { type = "control", action = "drag-cancel" }, { clients = { tagged } }))
	placement.place(
		state,
		input(0.08, { type = "control", action = "resize-start", address = "0x1" }, { clients = { tagged } })
	)
	placement.place(state, input(0.09, { type = "compositor", name = "resizewindow", address = "0x3" }))
	assert.is_nil(state.reconcile_addresses["0x3"])

	local resized = client("0x1", 100, 100, 800, 450, { tags = { "pip-bottom-right" } })
	local _, held = placement.place(state, input(0.1, { type = "tick" }, { clients = { resized } }))
	assert.equal(0, #of_kind(held, "move"))
end)

it("coalesces queued reconciliations and preserves default-corner assignment", function()
	local state = placement.new()
	placement.place(state, input(0, { type = "compositor", name = "openwindow", address = "0x1" }))
	placement.place(state, input(0.05, { type = "compositor", name = "resizewindow", address = "0x1" }))
	placement.place(state, input(0.06, { type = "compositor", name = "openwindow", address = "0x2" }))
	assert.equal(0.16, state.reconcile_at)
	assert.is_true(state.reconcile_addresses["0x1"])
	assert.is_true(state.reconcile_addresses["0x2"])

	local first = client("0x1", rest_x, rest_y, 400, 225)
	local second = client("0x2", rest_x, rest_y, 400, 225)
	local _, commands = placement.place(state, input(0.16, { type = "tick" }, { clients = { first, second } }))

	assert.is_nil(state.reconcile_at)
	assert.same({}, state.reconcile_addresses)
	local tags = of_kind(commands, "tag")
	assert.equal(2, #tags)
	assert.same(
		{ ["0x1"] = true, ["0x2"] = true },
		{ [tags[1].address] = tags[1].add, [tags[2].address] = tags[2].add }
	)
end)

it("interrupts pending acceptance when a new interaction or layout transition supersedes it", function()
	local function pending_state()
		local state = placement.new()
		local dragged = client("0x1", 2960, 1150, 400, 225)
		placement.place(state, input(0, { type = "control", action = "drag-start", address = "0x1" }))
		placement.place(state, input(0.1, { type = "control", action = "drag-end" }, { clients = { dragged } }))
		return state, client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	end

	for _, action in ipairs({ "drag-start", "resize-start", "waybar-show", "waybar-hide" }) do
		local state, window = pending_state()
		placement.place(
			state,
			input(0.2, { type = "control", action = action, address = "0x1" }, { clients = { window } })
		)
		assert.is_nil(state.pending_acceptance)
	end

	local moved, window = pending_state()
	placement.place(
		moved,
		input(0.2, { type = "control", action = "move", address = "0x1", direction = "left" }, { clients = { window } })
	)
	assert.is_table(moved.pending_acceptance)
	assert.equal("0x1", moved.pending_acceptance.address)
	assert.equal("bottom-left", moved.pending_acceptance.corner)

	local monitor_changed, observed = pending_state()
	placement.place(monitor_changed, input(0.2, { type = "monitorchange" }, { clients = { observed } }))
	assert.is_nil(monitor_changed.pending_acceptance)
end)

it("ignores no-op nested events and rejects invalid move targets without changing placement state", function()
	local state = placement.new()
	local baseline = placement.new()
	local events = {
		{ type = "configreload" },
		{ type = "compositor", name = "closewindow", address = "0x1" },
		{ type = "control", action = "ping" },
		{ type = "control", action = "quit" },
		{ type = "control", action = "drag-end" },
		{ type = "control", action = "resize-end" },
		{ type = "control", action = "resize-cancel" },
		{ type = "control", action = "unknown", address = "0x1" },
		{ type = "compositor", name = "unknown", address = "0x1" },
		{ type = "control", action = "move", address = "0x1", direction = "diagonal" },
		{ type = "control", action = "move", direction = "left" },
	}
	for _, event in ipairs(events) do
		local _, commands = placement.place(state, input(0, event))
		assert.equal(0, #commands)
	end

	local missing_monitor = client("0x1", rest_x, rest_y, 400, 225, { monitor = 9, tags = { "pip-bottom-right" } })
	local _, commands = placement.place(
		state,
		input(
			0,
			{ type = "control", action = "move", address = "0x1", direction = "left" },
			{ clients = { missing_monitor } }
		)
	)
	assert.equal(0, #commands)
	assert.same(baseline, state)

	local pending = {
		address = "0x1",
		corner = "bottom-right",
		deadline = 1,
		target_monitor = "ultrawide",
		x = rest_x,
		y = rest_y,
	}
	state.pending_acceptance = pending
	_, commands = placement.place(
		state,
		input(
			0,
			{ type = "control", action = "move", address = "0x1", direction = "diagonal" },
			{ clients = { client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } }) } }
		)
	)
	assert.equal(0, #commands)
	assert.same(pending, state.pending_acceptance)
end)

it("filters non-PiP clients from startup placement", function()
	local state = placement.new({ waybar_visible = true })
	local bar = { ultrawide = { placement.rectangle(0, 1408, 3440, 32) } }
	local floating = client("0x1", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local unmapped = client("0x2", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local hidden = client("0x3", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	local unrelated = client("0x4", rest_x, rest_y, 400, 225, { tags = { "pip-bottom-right" } })
	floating.floating = false
	unmapped.mapped = false
	hidden.hidden = true
	unrelated.class = "other"

	local _, commands = placement.place(
		state,
		input(0, { type = "startup" }, { clients = { floating, unmapped, hidden, unrelated }, bars = bar })
	)
	assert.equal(0, #commands)
end)

it("raises an error for unknown top-level placement events", function()
	local ok, err = pcall(function()
		placement.place(placement.new(), input(0, { type = "unknown" }))
	end)

	assert.is_false(ok)
	assert.matches("unknown PiP placement event type: unknown", err)
end)
