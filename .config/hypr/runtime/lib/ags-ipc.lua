local M = {}

local command = require("lib.command")
local empty_opts = {}
local busctl_ready = nil

local function busctl_available()
	if busctl_ready ~= nil then
		return busctl_ready
	end

	busctl_ready = command.ok("command -v busctl >/dev/null 2>&1")
	return busctl_ready
end

local function parse_busctl_string(response)
	response = response:gsub("%s+$", "")

	local quoted = response:match('^s "(.*)"$')
	if quoted then
		return (quoted:gsub('\\"', '"'):gsub('\\\\', '\\'))
	end

	return response:match("^s (.*)$")
end

function M.request(component, payload, opts)
	opts = opts or empty_opts
	payload = payload or ""

	local instance = opts.instance or os.getenv("AGS_INSTANCE") or "ags-bundled"
	local timeout = opts.timeout or 0.5

	if busctl_available() then
		local response = command.output(table.concat({
			"busctl --user",
			"--timeout=" .. command.arg(timeout),
			"call",
			command.arg("io.Astal." .. instance),
			"/io/Astal/Application",
			"io.Astal.Application",
			"Request",
			"as",
			"2",
			command.arg(component),
			command.arg(payload),
			"2>/dev/null",
		}, " "))

		local parsed = parse_busctl_string(response)
		if parsed then
			return parsed
		end
	end

	return command.output(table.concat({
		"ags request -i",
		command.arg(instance),
		command.arg(component),
		command.arg(payload),
		"2>/dev/null",
	}, " ")):gsub("%s+$", "")
end

return M
