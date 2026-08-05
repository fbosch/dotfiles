local paths = require("fbb.paths")

local M = {}

---@return string
local function command_path()
	return paths.join(paths.fbb_dir(), "bin", "ocma")
end

---@param run_command fun(command: string, args: string[]): boolean, boolean, string
---@param subcommand string
---@param args string[]
---@return boolean ran
---@return boolean ok
---@return string output
local function run_ocma(run_command, subcommand, args)
	local command_args = { subcommand }
	for _, arg in ipairs(args) do
		table.insert(command_args, arg)
	end
	return run_command(command_path(), command_args)
end

---@param run_command fun(command: string, args: string[]): boolean, boolean, string
---@param decode_json fun(content: string): table
---@return table[]|nil
function M.list(run_command, decode_json)
	assert(type(run_command) == "function", "run_command must be a function")
	local ran, _, output = run_ocma(run_command, "list", { "--format", "json" })
	if ran == false then
		return nil
	end
	return M.read_accounts(output, decode_json)
end

---@param seconds number|nil
---@return string|nil
local function format_reset(seconds)
	if type(seconds) ~= "number" then
		return nil
	end
	if seconds <= 0 then
		return "now"
	end
	if seconds < 60 then
		return string.format("%ds", math.ceil(seconds))
	end
	if seconds < 3600 then
		return string.format("%dm", math.ceil(seconds / 60))
	end
	if seconds < 86400 then
		return string.format("%dh", math.ceil(seconds / 3600))
	end
	return string.format("%dd", math.ceil(seconds / 86400))
end

---@param content string
---@param decode_json fun(content: string): table
---@return table[]|nil
function M.read_accounts(content, decode_json)
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
