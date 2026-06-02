local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/benchmarks/json%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local default_iterations = tonumber(os.getenv("HYPR_BENCH_ITERATIONS") or "10000") or 10000

local function run_case(name, iterations, fn)
	collectgarbage("collect")
	local before_memory = collectgarbage("count")
	local start = os.clock()
	for _ = 1, iterations do
		fn()
	end
	local elapsed = os.clock() - start
	local after_memory = collectgarbage("count")
	print(string.format(
		"%-30s %9d iters %10.3f us/call %8.3f ms total mem_delta=%.1f KiB",
		name,
		iterations,
		elapsed * 1000000 / iterations,
		elapsed * 1000,
		after_memory - before_memory
	))
end

local small_table = {
	class = "org.wezfurlong.wezterm",
	matcher = "match:class",
	pattern = "^org\\.wezfurlong\\.wezterm$",
	monitor = "DP-2",
	x = 1446,
	y = 506,
	width = 1684,
	height = 1428,
}

local small_json = json.encode(small_table)

local window_state = {}
for index = 1, 20 do
	window_state[index] = {
		class = "fixture.class." .. index,
		matcher = "match:class",
		pattern = "^fixture\\.class\\." .. index .. "$",
		monitor = index % 2 == 0 and "DP-2" or "HDMI-A-2",
		x = 100 + index,
		y = 200 + index,
		width = 900 + index,
		height = 700 + index,
	}
end

local window_state_json = json.encode(window_state)

local escaped_table = {
	quote = 'title "with quotes"',
	path = "C:\\tmp\\fixture",
	multiline = "one\ntwo\tthree",
	flags = { visible = true, mapped = false },
}

local escaped_json = json.encode(escaped_table)

local function assert_roundtrip()
	local decoded = json.decode(window_state_json)
	assert(#decoded == #window_state, "window-state decode count mismatch")
	assert(decoded[1].class == window_state[1].class, "window-state decode class mismatch")
	assert(json.decode(escaped_json).multiline == escaped_table.multiline, "escaped decode mismatch")
end

assert_roundtrip()

local cases = {
	encode_small = function(iterations)
		run_case("json.encode/small", iterations, function()
			json.encode(small_table)
		end)
	end,
	decode_small = function(iterations)
		run_case("json.decode/small", iterations, function()
			json.decode(small_json)
		end)
	end,
	encode_window_state = function(iterations)
		run_case("json.encode/window-state-20", iterations, function()
			json.encode(window_state)
		end)
	end,
	decode_window_state = function(iterations)
		run_case("json.decode/window-state-20", iterations, function()
			json.decode(window_state_json)
		end)
	end,
	decode_escaped = function(iterations)
		run_case("json.decode/escaped", iterations, function()
			json.decode(escaped_json)
		end)
	end,
}

local selected = arg[1] or "all"
local iterations = tonumber(arg[2]) or default_iterations

if selected == "all" then
	for _, name in ipairs({ "encode_small", "decode_small", "encode_window_state", "decode_window_state", "decode_escaped" }) do
		cases[name](iterations)
	end
elseif cases[selected] then
	cases[selected](iterations)
else
	print("usage: lua " .. script_path .. " [all|encode_small|decode_small|encode_window_state|decode_window_state|decode_escaped] [iterations]")
	os.exit(2)
end
