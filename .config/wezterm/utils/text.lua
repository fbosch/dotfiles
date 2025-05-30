local M = {}

function M.truncate_path(path)
	-- Normalize path separators
	path = path:gsub("\\", "/")

	-- Split path into components
	local parts = {}
	for part in path:gmatch("[^/]+") do
		table.insert(parts, part)
	end

	-- Git repository root detection
	local git_root_index = nil
	for i = #parts, 1, -1 do
		if parts[i] == ".git" then
			git_root_index = i - 1
			break
		end
	end

	-- Truncation logic
	local max_components = 3
	local start_index = 1

	-- If in a git repository, adjust starting point
	if git_root_index then
		start_index = math.max(1, git_root_index - max_components + 1)
	else
		-- For non-git paths, start from the end
		start_index = math.max(1, #parts - max_components + 1)
	end

	-- Construct truncated path
	local truncated_parts = {}
	local ellipsis_added = false

	for i = start_index, #parts do
		-- Add ellipsis before git root or first meaningful component
		if not ellipsis_added and i > start_index then
			table.insert(truncated_parts, "…")
			ellipsis_added = true
		end

		table.insert(truncated_parts, parts[i])
	end

	-- Handle special cases
	if #truncated_parts == 0 then
		return path
	end

	return table.concat(truncated_parts, "/")
end

return M
