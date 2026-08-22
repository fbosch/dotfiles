local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_state_rules_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local command_calls = 0

local function read_file(path)
	local handle = assert(io.open(path, "r"))
	local content = handle:read("*a")
	handle:close()
	return content
end

local function write_file(path, content)
	local handle = assert(io.open(path, "w"))
	handle:write(content)
	handle:close()
end

local function assert_contains(content, expected)
	assert.is_truthy(content:find(expected, 1, true), "missing " .. expected)
end

local function assert_not_contains(content, unexpected)
	assert.is_nil(content:find(unexpected, 1, true), "unexpected " .. unexpected)
end

local function saved_window(monitor, x, y, width, height, class, pattern)
	return {
		class = class or "Test",
		matcher = "match:class",
		pattern = pattern or class or "Test",
		monitor = monitor,
		x = x,
		y = y,
		width = width,
		height = height,
	}
end

local function generated_rule(path, monitor)
	local rules = assert(assert(loadfile(path))())
	for _, rule in ipairs(rules) do
		if rule.monitor == monitor then
			return rule
		end
	end

	return nil
end

describe("window-state rules", function()
	local rules
	local temp_dir
	local options

	before_each(function()
		command_calls = 0
		package.loaded["lib.command"] = {
			arg = function(value)
				return string.format("%q", value)
			end,
			ok = function(line)
				command_calls = command_calls + 1
				return os.execute(line) == 0
			end,
		}
		package.loaded["runtime.windows.daemons.window-state.rules"] = nil
		rules = require("runtime.windows.daemons.window-state.rules")
		temp_dir = os.tmpname()
		os.remove(temp_dir)
		options = {
			config_dir = temp_dir,
			rules_lua_file = temp_dir .. "/rules/window-state.lua",
			selectors_lua_file = "test-selectors.lua",
			cache = {
				["match:class Test"] = {
					matcher = "match:class",
					pattern = "Test",
					monitor = "DP-1",
					x = 10,
					y = 20,
					width = 300,
					height = 400,
				},
			},
		}
	end)

	after_each(function()
		os.execute("rm -rf " .. string.format("%q", temp_dir))
	end)

	it("skips writes when generated rules are unchanged", function()
		assert.is_true(rules.write_rules_file(options))
		assert.are.equal(1, command_calls)

		command_calls = 0
		assert.is_false(rules.write_rules_file(options))
		assert.are.equal(0, command_calls)
	end)

	it("renders monitor-scoped rules without a monitor effect", function()
		assert.is_true(rules.write_rules_file(options))

		local content = read_file(options.rules_lua_file)
		assert_contains(content, 'monitor = "DP-1",')
		assert_contains(content, 'class = "^Test$",')
		assert_contains(content, 'workspace = "m[DP-1]",')
		assert_contains(content, 'fullscreen_state = "0 0",')
		assert_contains(content, 'size = "300 400",')
		assert_contains(content, 'move = "10 20",')
		assert_not_contains(content, '      monitor = "DP-1",')

		local rule = assert(generated_rule(options.rules_lua_file, "DP-1"))
		assert.are.equal("m[DP-1]", rule.match.workspace)
		assert.are.equal("0 0", rule.effects.fullscreen_state)
		assert.are.equal("300 400", rule.effects.size)
		assert.are.equal("10 20", rule.effects.move)
		assert.is_nil(rule.effects.monitor)
	end)

	it("anchors literals and preserves regular expressions", function()
		options.cache = {
			literal = {
				matcher = "match:class",
				pattern = "Test",
				monitor = "DP-1",
				x = 10,
				y = 20,
				width = 300,
				height = 400,
			},
			regex = {
				matcher = "match:class",
				pattern = "Test.+",
				monitor = "HDMI-A-1",
				x = 30,
				y = 40,
				width = 500,
				height = 600,
			},
		}
		assert.is_true(rules.write_rules_file(options))

		local content = read_file(options.rules_lua_file)
		assert_contains(content, 'class = "^Test$",')
		assert_contains(content, 'class = "Test.+",')
	end)

	it("renders the first matching opted-in tag as a separate rule", function()
		options.cache = {
			pip = {
				matcher = "match:initial_title",
				pattern = "^Picture-in-Picture$",
				monitor = "DP-1",
				x = 15,
				y = 15,
				width = 300,
				height = 200,
				tags = { "pip-top-left", "pip-top-right", "unrelated" },
			},
		}
		options.selectors = {
			{
				matcher = "match:initial_title",
				pattern = "^Picture-in-Picture$",
				persist_tags = { "pip-top-left", "pip-top-right" },
			},
		}
		assert.is_true(rules.write_rules_file(options))

		local content = read_file(options.rules_lua_file)
		assert_contains(content, 'tags = { "pip-top-left" },')
		assert_contains(content, 'tag = "+pip-top-left",')
		assert_not_contains(content, 'tag = "+pip-top-right",')
		assert_not_contains(content, "unrelated")

		local cache = rules.load_rules_cache(options.rules_lua_file)
		local entry
		for _, candidate in pairs(cache) do
			if candidate.matcher == "match:initial_title" and candidate.pattern == "^Picture-in-Picture$" then
				entry = candidate
				break
			end
		end
		assert.is_not_nil(entry)
		assert.are.same({ "pip-top-left" }, entry.tags)
	end)

	it("renders global state without monitor metadata or workspace matching", function()
		options.cache = {
			pip = {
				matcher = "match:initial_title",
				pattern = "^Picture-in-Picture$",
				monitor = "",
				x = 15,
				y = 15,
				width = 300,
				height = 200,
			},
		}
		options.selectors = {
			{ matcher = "match:initial_title", pattern = "^Picture-in-Picture$", per_monitor = false },
		}
		assert.is_true(rules.write_rules_file(options))

		local content = read_file(options.rules_lua_file)
		assert_contains(content, 'id = "window-state:match:initial_title:^Picture-in-Picture$:global",')
		assert_not_contains(content, "monitor =")
		assert_not_contains(content, "workspace =")
	end)

	it("retains independent geometry for each monitor", function()
		options.cache = {}
		rules.update_cache_from_windows(
			options.cache,
			json.encode({
				saved_window("DP-1", 10, 20, 300, 400),
				saved_window("HDMI-A-1", 30, 40, 500, 600),
			})
		)
		rules.update_cache_from_windows(
			options.cache,
			json.encode({
				saved_window("DP-1", 50, 60, 700, 800),
			})
		)

		assert.is_true(rules.write_rules_file(options))

		local dp_rule = assert(generated_rule(options.rules_lua_file, "DP-1"))
		assert.are.equal("m[DP-1]", dp_rule.match.workspace)
		assert.are.equal("700 800", dp_rule.effects.size)
		assert.are.equal("50 60", dp_rule.effects.move)

		local hdmi_rule = assert(generated_rule(options.rules_lua_file, "HDMI-A-1"))
		assert.are.equal("m[HDMI-A-1]", hdmi_rule.match.workspace)
		assert.are.equal("500 600", hdmi_rule.effects.size)
		assert.are.equal("30 40", hdmi_rule.effects.move)
	end)

	it("prunes every monitor entry for removed selectors", function()
		options.cache = {}
		rules.update_cache_from_windows(
			options.cache,
			json.encode({
				saved_window("DP-1", 10, 20, 300, 400),
				saved_window("HDMI-A-1", 30, 40, 500, 600),
				saved_window("DP-1", 1, 2, 3, 4, "Other"),
			})
		)

		rules.prune_rules_cache(options.cache, {
			{ matcher = "match:class", pattern = "Test" },
		})
		assert.is_true(rules.write_rules_file(options))

		local content = read_file(options.rules_lua_file)
		assert_contains(content, 'workspace = "m[DP-1]",')
		assert_contains(content, 'workspace = "m[HDMI-A-1]",')
		assert_not_contains(content, 'class = "^Other$",')
	end)

	it("migrates legacy monitor effects to monitor-scoped rules", function()
		os.execute("mkdir -p " .. string.format("%q", temp_dir .. "/rules"))
		write_file(
			options.rules_lua_file,
			[[return {
  {
    id = "window-state:match:class:Test",
    matcher = "match:class",
    pattern = "Test",
    match = { class = "^Test$" },
    effects = {
      monitor = "DP-1",
      size = "300 400",
      move = "10 20",
    },
  },
}
]]
		)
		options.cache = rules.load_rules_cache(options.rules_lua_file)

		assert.is_true(rules.write_rules_file(options))

		local content = read_file(options.rules_lua_file)
		assert_contains(content, 'monitor = "DP-1",')
		assert_contains(content, 'workspace = "m[DP-1]",')
		assert_not_contains(content, '      monitor = "DP-1",')

		local rule = assert(generated_rule(options.rules_lua_file, "DP-1"))
		assert.are.equal("300 400", rule.effects.size)
		assert.are.equal("10 20", rule.effects.move)
	end)
end)
