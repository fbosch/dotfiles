local M = {}

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

function M.arg(value)
	return shell_quote(value)
end

function M.line(...)
	local parts = { ... }
	for index, part in ipairs(parts) do
		parts[index] = shell_quote(part)
	end

	return table.concat(parts, " ")
end

function M.ok(command)
	local ok, _, code = os.execute(command)
	return ok == true or ok == 0 or code == 0
end

function M.output_line(command)
	local handle = io.popen(command)
	if not handle then
		return ""
	end

	local output = handle:read("*l") or ""
	handle:close()
	return output
end

function M.output(command)
	local handle = io.popen(command)
	if not handle then
		return ""
	end

	local output = handle:read("*a") or ""
	handle:close()
	return output
end

return M
