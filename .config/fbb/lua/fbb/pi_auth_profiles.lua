local paths = require("fbb.paths")

local M = {}
local output_schema = "fbb.pi-auth-profiles-usage/v1"

---@return string
local function agent_dir()
	return os.getenv("PI_CODING_AGENT_DIR") or paths.join(os.getenv("HOME") or "", "dotfiles", ".pi", "agent")
end

---@return string
local function command_path()
	return paths.join(agent_dir(), "extensions", "auth-profiles", "usage-status.ts")
end

---@param run_command fun(command: string, args: string[]): boolean, boolean, string
---@param decode_json fun(content: string): table
---@param cwd string|nil
---@return table[]|nil
function M.list(run_command, decode_json, cwd)
	assert(type(run_command) == "function", "run_command must be a function")
	local args = { command_path(), "--agent-dir", agent_dir() }
	if type(cwd) == "string" and cwd ~= "" then
		table.insert(args, "--cwd")
		table.insert(args, cwd)
	end

	local ran, ok, output = run_command("bun", args)
	if ran == false or ok == false then
		return nil
	end
	return M.read_accounts(output, decode_json)
end

---@param content string
---@param decode_json fun(content: string): table
---@return table[]|nil
function M.read_accounts(content, decode_json)
	local parsed_ok, payload = pcall(decode_json, content)
	if not parsed_ok or type(payload) ~= "table" or payload.schema ~= output_schema then
		return nil
	end
	if type(payload.profiles) ~= "table" then
		return nil
	end

	local accounts = {}
	for _, profile in ipairs(payload.profiles) do
		if type(profile) == "table" and type(profile.profileLabel) == "string" then
			table.insert(accounts, {
				profileLabel = profile.profileLabel,
				availableCount = tonumber(profile.availableCount),
				urgency = profile.urgency,
				usage = type(profile.usage) == "table" and profile.usage or {},
				active = profile.active == true,
			})
		end
	end
	return accounts
end

return M
