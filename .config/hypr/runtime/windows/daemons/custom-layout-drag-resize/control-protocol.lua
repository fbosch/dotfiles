local M = {}

function M.next_sequence(path)
	local sequence = 0
	local handle = io.open(path, "r")
	if handle then
		sequence = assert(tonumber(handle:read("*l")), "invalid custom layout resize sequence")
		handle:close()
	end

	sequence = sequence + 1
	handle = assert(io.open(path, "w"))
	assert(handle:write(tostring(sequence), "\n"))
	handle:close()
	return sequence
end

function M.parse(line)
	local action, sequence = line:match("^(%a+) (%d+)$")
	if (action == "start" or action == "stop") and sequence then
		return { action = action, sequence = tonumber(sequence) }
	end

	if line == "ping" or line == "quit" then
		return { action = line }
	end

	return nil
end

function M.is_newer(command, latest_sequence)
	return command.sequence == nil or command.sequence > latest_sequence
end

return M
