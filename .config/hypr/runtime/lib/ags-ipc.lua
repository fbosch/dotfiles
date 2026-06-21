local M = {}

local empty_opts = {}
local busctl_ready = nil

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function command_output(command)
	local handle = io.popen(command)
	if not handle then
		return ""
	end

	local output = handle:read("*a") or ""
	handle:close()
	return output
end

local function command_ok(command)
	local ok, _, code = os.execute(command)
	return ok == true or ok == 0 or code == 0
end

local function busctl_available()
	if busctl_ready ~= nil then
		return busctl_ready
	end

	busctl_ready = command_ok("command -v busctl >/dev/null 2>&1")
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
		local response = command_output(table.concat({
			"busctl --user",
			"--timeout=" .. shell_quote(timeout),
			"call",
			shell_quote("io.Astal." .. instance),
			"/io/Astal/Application",
			"io.Astal.Application",
			"Request",
			"as",
			"2",
			shell_quote(component),
			shell_quote(payload),
			"2>/dev/null",
		}, " "))

		local parsed = parse_busctl_string(response)
		if parsed then
			return parsed
		end
	end

	return command_output(table.concat({
		"ags request -i",
		shell_quote(instance),
		shell_quote(component),
		shell_quote(payload),
		"2>/dev/null",
	}, " ")):gsub("%s+$", "")
end

return M
