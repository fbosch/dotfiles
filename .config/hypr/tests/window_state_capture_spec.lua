local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_state_capture_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local capture = require("runtime.windows.daemons.window-state.capture")
local json = require("lib.json")

local monitors = {
	{ id = "1", name = "DP-1", x = 100, y = 200 },
	{ id = "2", name = "HDMI-A-1", x = 1000, y = 100 },
}

local function client(class, monitor, x, y, width, height, opts)
	opts = opts or {}
	return {
		class = class,
		initialTitle = opts.initial_title,
		floating = opts.floating ~= false,
		fullscreen = opts.fullscreen,
		fullscreenClient = opts.fullscreen_client,
		monitor = monitor,
		at = { x, y },
		size = { width, height },
		tags = opts.tags,
	}
end

it("captures monitor-relative records in deterministic class order", function()
	local selectors = {
		{ matcher = "match:class", pattern = "^nemo$", per_monitor = true },
		{ matcher = "match:class", pattern = "^Bitwarden$", per_monitor = true },
	}
	local clients = {
		client("nemo", 2, 1030, 140, 500, 600),
		client("Bitwarden", 1, 130, 240, 1000, 700),
	}

	local windows = json.array(capture.snapshot(selectors, clients, monitors))
	assert.equal(2, #windows)
	assert.same({
		class = "Bitwarden",
		matcher = "match:class",
		pattern = "^Bitwarden$",
		monitor = "DP-1",
		x = 30,
		y = 40,
		width = 1000,
		height = 700,
	}, windows[1])
	assert.same({
		class = "nemo",
		matcher = "match:class",
		pattern = "^nemo$",
		monitor = "HDMI-A-1",
		x = 30,
		y = 40,
		width = 500,
		height = 600,
	}, windows[2])
end)

it("filters excluded, tiled, and fullscreen clients", function()
	local selectors = {
		{
			matcher = "match:class",
			pattern = "^nemo$",
			per_monitor = true,
			exclude = {
				matcher = "match:initialTitle",
				patterns = { "^File Operations$", "^Preparing$" },
			},
		},
	}
	local clients = {
		client("nemo", 1, 110, 220, 800, 600),
		client("nemo", 1, 110, 220, 300, 200, { initial_title = "File Operations" }),
		client("nemo", 1, 110, 220, 300, 200, { floating = false }),
		client("nemo", 1, 110, 220, 1920, 1080, { fullscreen = 1 }),
		client("nemo", 1, 110, 220, 1920, 1080, { fullscreen_client = 1 }),
	}

	local windows = json.array(capture.snapshot(selectors, clients, monitors))
	assert.equal(1, #windows)
	assert.equal(800, windows[1].width)
end)

it("persists the first configured tag and keeps global monitor scope", function()
	local selectors = {
		{
			matcher = "match:initialTitle",
			pattern = "^Picture-in-Picture$",
			per_monitor = false,
			restore_monitor = true,
			persist_tags = { "pip-top-left", "pip-top-right" },
		},
	}
	local clients = {
		client("app.zen_browser.zen", 1, 115, 215, 500, 300, {
			initial_title = "Picture-in-Picture",
			tags = { "pip-top-right*", "pip-top-left*", "unrelated" },
		}),
	}

	local windows = json.array(capture.snapshot(selectors, clients, monitors))
	assert.equal(1, #windows)
	assert.equal("", windows[1].monitor)
	assert.equal("DP-1", windows[1].target_monitor)
	assert.equal(15, windows[1].x)
	assert.equal(15, windows[1].y)
	assert.same({ "pip-top-left" }, windows[1].tags)
end)

it("returns an empty snapshot for no selectors or invalid patterns", function()
	local clients = { client("nemo", 1, 110, 220, 800, 600) }
	assert.same({}, json.array(capture.snapshot({}, clients, monitors)))
	assert.same(
		{},
		json.array(
			capture.snapshot({ { matcher = "match:class", pattern = "[", per_monitor = true } }, clients, monitors)
		)
	)
end)
