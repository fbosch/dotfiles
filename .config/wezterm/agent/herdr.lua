local wezterm = require("wezterm")

local M = {}

local refresh_interval_seconds = 5
local cache = { checked_at = 0, working = 0, blocked = 0 }

function M.get_summary()
	local now = os.time()
	if now - cache.checked_at < refresh_interval_seconds then
		return cache
	end

	cache.checked_at = now
	cache.working = 0
	cache.blocked = 0

	local ok, stdout = wezterm.run_child_process({ "herdr", "agent", "list" })
	if ok == false then
		return cache
	end

	local parsed_ok, response = pcall(wezterm.json_parse, stdout)
	local agents = parsed_ok and response and response.result and response.result.agents
	if type(agents) ~= "table" then
		return cache
	end

	for _, agent in ipairs(agents) do
		if agent.agent_status == "working" then
			cache.working = cache.working + 1
		elseif agent.agent_status == "blocked" then
			cache.blocked = cache.blocked + 1
		end
	end

	return cache
end

return M
