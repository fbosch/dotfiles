local M = {}

M.defaults = {
	waiting_patterns = {
		"type your own answer",
		"yes, allow once",
		"yes, allow always",
		"allow once",
		"allow always",
		"enter confirm",
		"esc dismiss",
		"do you trust",
		"run this command",
		"(y/n)",
		"[y/n]",
	},
	working_patterns = {
		"esc interrupt",
		"thinking",
		"in progress",
		"running commands",
		"making edits",
		"searching the codebase",
		"searching the web",
	},
	screen_markers = {
		"type your own answer",
		"enter confirm",
		"esc dismiss",
	},
}

function M.strip_ansi(text)
	if text == nil then
		return ""
	end

	return text:gsub("\27%[[%d;]*[A-Za-z]", "")
end

function M.matches_any_pattern(text, patterns)
	if text == nil or text == "" then
		return false
	end

	local lower = text:lower()
	for _, pattern in ipairs(patterns or {}) do
		if lower:find(pattern, 1, true) then
			return true
		end
	end

	return false
end

function M.get_last_lines(text, count)
	if text == nil or text == "" then
		return ""
	end

	local lines = {}
	for line in text:gmatch("[^\n]+") do
		lines[#lines + 1] = line
	end

	if #lines == 0 then
		return ""
	end

	local start_index = math.max(1, #lines - count + 1)
	local result = {}
	for i = start_index, #lines do
		result[#result + 1] = lines[i]
	end

	return M.strip_ansi(table.concat(result, "\n")):lower()
end

function M.get_last_non_empty_line(text)
	if text == nil or text == "" then
		return ""
	end

	local last = ""
	for line in text:gmatch("[^\n]+") do
		local trimmed = line:match("^%s*(.-)%s*$") or ""
		if trimmed ~= "" then
			last = trimmed
		end
	end

	return last
end

function M.detect_status_from_text(text, waiting_patterns, working_patterns)
	if text == nil or text == "" then
		return nil
	end

	local waiting_recent = M.get_last_lines(text, 30)
	if M.matches_any_pattern(waiting_recent, waiting_patterns or M.defaults.waiting_patterns) then
		return "waiting"
	end

	local working_recent = M.get_last_lines(text, 10)
	if M.matches_any_pattern(working_recent, working_patterns or M.defaults.working_patterns) then
		return "working"
	end

	local idle_candidate = M.get_last_non_empty_line(M.get_last_lines(text, 5))
	if idle_candidate == ">" or idle_candidate:find("^>%s") then
		return "idle"
	end

	return nil
end

function M.detect_overlay_state_from_text(options)
	local text = options and options.text or ""
	if text == "" then
		return nil
	end

	local recent_120 = M.get_last_lines(text, 120)
	if recent_120 == "" then
		return nil
	end

	local waiting_patterns = options.waiting_patterns or M.defaults.waiting_patterns
	local working_patterns = options.working_patterns or M.defaults.working_patterns
	local screen_markers = options.screen_markers or M.defaults.screen_markers

	if options.has_opencode_process == true then
		local status = M.detect_status_from_text(recent_120, waiting_patterns, working_patterns)
		if status == nil then
			status = "idle"
		end

		return {
			agent_type = "opencode",
			status = status,
			source = "overlay",
			confidence = "confirmed",
		}
	end

	local can_use_hinted_fallback = M.matches_any_pattern(recent_120, screen_markers)
	if can_use_hinted_fallback == false then
		return nil
	end

	if M.matches_any_pattern(M.get_last_lines(recent_120, 30), waiting_patterns) == false then
		return nil
	end

	return {
		agent_type = "opencode",
		status = "waiting",
		source = "overlay",
		confidence = "hinted",
	}
end

return M
