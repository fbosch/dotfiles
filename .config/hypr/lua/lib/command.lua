local M = {}

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

return M
