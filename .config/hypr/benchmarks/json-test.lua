local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/benchmarks/json%-test%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")

local tests = {}

local function test(name, fn)
	tests[#tests + 1] = { name = name, fn = fn }
end

local function assert_equal(actual, expected, message)
	assert(actual == expected, string.format("%s: expected %q, got %q", message, tostring(expected), tostring(actual)))
end

local function assert_fails(source, message)
	local ok = pcall(json.decode, source)
	assert(not ok, message .. ": expected decode failure")
end

test("decode primitives", function()
	assert_equal(json.decode("true"), true, "true")
	assert_equal(json.decode("false"), false, "false")
	assert_equal(json.decode("null"), json.null, "null")
	assert_equal(json.decode("-12.5e2"), -1250, "exponent")
end)

test("decode strings", function()
	local decoded = json.decode([=[{"quote":"\"","slash":"\\","line":"one\ntwo","tab":"one\ttwo"}]=])
	assert_equal(decoded.quote, '"', "quote escape")
	assert_equal(decoded.slash, "\\", "slash escape")
	assert_equal(decoded.line, "one\ntwo", "newline escape")
	assert_equal(decoded.tab, "one\ttwo", "tab escape")
end)

test("decode unicode", function()
	local decoded = json.decode([=[{"letters":"\u00e6\u00f8\u00e5","rocket":"\ud83d\ude80"}]=])
	assert_equal(decoded.letters, "æøå", "unicode letters")
	assert_equal(decoded.rocket, "🚀", "surrogate pair")
end)

test("decode nested arrays and objects", function()
	local decoded = json.decode([=[{"outer":[{"name":"one"},{"name":"two","items":[1,2,3]}]}]=])
	assert_equal(decoded.outer[1].name, "one", "first nested object")
	assert_equal(decoded.outer[2].name, "two", "second nested object")
	assert_equal(decoded.outer[2].items[3], 3, "nested array")
end)

test("preserve null array entries", function()
	local decoded = json.decode("[null,true]")
	assert_equal(#decoded, 2, "array length with null")
	assert_equal(decoded[1], json.null, "null sentinel")
	assert_equal(decoded[2], true, "value after null")
end)

test("encode null sentinel", function()
	assert_equal(json.encode(json.null), "null", "encode null")
	assert_equal(json.encode({ json.null, true }), "[null,true]", "encode null array")
end)

test("roundtrip generated-like payload", function()
	local payload = {
		{
			class = "fixture.class",
			matcher = "match:class",
			pattern = "^fixture\\.class$",
			monitor = "DP-2",
			x = 12,
			y = 34,
			width = 800,
			height = 600,
		},
	}
	local decoded = json.decode(json.encode(payload))
	assert_equal(decoded[1].class, payload[1].class, "roundtrip class")
	assert_equal(decoded[1].pattern, payload[1].pattern, "roundtrip pattern")
	assert_equal(decoded[1].width, payload[1].width, "roundtrip width")
end)

test("reject malformed json", function()
	assert_fails("{", "unterminated object")
	assert_fails("[1,]", "trailing array comma")
	assert_fails("{\"a\" 1}", "missing colon")
	assert_fails("\"unterminated", "unterminated string")
	assert_fails("\"\\u12\"", "short unicode escape")
	assert_fails("\"\\ud83d\"", "missing surrogate")
	assert_fails("true false", "trailing content")
end)

for _, case in ipairs(tests) do
	case.fn()
	print("ok", case.name)
end

print(string.format("%d json tests passed", #tests))
