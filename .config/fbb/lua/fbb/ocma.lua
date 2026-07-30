local M = {}

---@param cache_path string
---@param decode_json fun(content: string): table
---@param format_reset fun(reset_after_seconds: number|nil): string|nil
---@return table[]|nil
function M.read_accounts(cache_path, decode_json, format_reset)
	local cache_file = io.open(cache_path, "r")
	if not cache_file then
		return nil
	end

	local content = cache_file:read("*a")
	cache_file:close()

	local parsed_ok, payload = pcall(decode_json, content)
	local profiles = parsed_ok and type(payload) == "table" and payload.data and payload.data.profiles or nil
	if type(profiles) ~= "table" then
		return nil
	end

	local accounts = {}
	for _, profile in ipairs(profiles) do
		local usage = {}
		for _, name in ipairs({ "primary", "secondary" }) do
			local window = type(profile.usage) == "table" and profile.usage[name] or nil
			table.insert(usage, {
				remaining = type(window) == "table" and window.remainingPercent or nil,
				resetsIn = type(window) == "table" and format_reset(window.resetAfterSeconds) or nil,
			})
		end
		local reset_credits = type(profile.resetCredits) == "table" and profile.resetCredits or {}
		table.insert(accounts, {
			profileLabel = tostring(profile.alias or profile.generatedLabel or "unresolved"),
			availableCount = reset_credits.availableCount,
			urgency = reset_credits.urgency,
			usage = usage,
			active = profile.active,
		})
	end

	table.sort(accounts, function(left, right)
		return tostring(left.profileLabel) < tostring(right.profileLabel)
	end)
	return accounts
end

return M
