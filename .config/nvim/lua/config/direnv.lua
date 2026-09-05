local M = {}

local refresh_timeout_ms = 5000
local inherited_metadata = {
	"DIRENV_ACTIVE",
	"DIRENV_DIFF",
	"DIRENV_DIR",
	"DIRENV_FILE",
	"DIRENV_WATCHES",
}

local function copy_environment(environment)
	local copy = {}
	for name, value in pairs(environment) do
		if type(value) == "string" then
			copy[name] = value
		end
	end
	return copy
end

local startup_environment = copy_environment(vim.fn.environ())
local startup_path = startup_environment.PATH

local function inherited_direnv()
	for _, name in ipairs(inherited_metadata) do
		if type(startup_environment[name]) == "string" and startup_environment[name] ~= "" then
			return true
		end
	end
	return false
end

local clean_path = startup_path
local clean_baseline_ready = not inherited_direnv()
local setup_complete = false
local generation = 0
local pending
local synchronizing = false
local queued_cwd
local clean_baseline_process
local direnv_command = vim.fn.exepath("direnv")
if direnv_command == "" then
	direnv_command = "direnv"
end

local function canonical_path(path)
	if type(path) ~= "string" or path == "" then
		return nil
	end
	return vim.uv.fs_realpath(path) or vim.fs.normalize(path)
end

local function set_path(path)
	if vim.env.PATH == path then
		return
	end
	vim.env.PATH = path
end

local function is_within(path, root)
	if path == root then
		return true
	end
	if root == "/" then
		return path:sub(1, 1) == "/"
	end
	return path:sub(1, #root + 1) == root .. "/"
end

local function repository_root(cwd)
	local root = vim.fs.root(cwd, { ".git" })
	if root == nil then
		return cwd
	end
	return canonical_path(root) or cwd
end

local function envrc_directory(cwd)
	local root = repository_root(cwd)
	if not is_within(cwd, root) then
		return nil
	end

	local current = cwd
	while true do
		local stat = vim.uv.fs_stat(vim.fs.joinpath(current, ".envrc"))
		if stat ~= nil and stat.type == "file" then
			return current
		end
		if current == root then
			return nil
		end
		local parent = vim.fs.dirname(current)
		if parent == current then
			return nil
		end
		current = parent
	end
end

local function stop_process(process)
	if process == nil then
		return
	end
	pcall(function()
		process:kill(15)
	end)
end

local function stop_timer(timer)
	if timer ~= nil then
		pcall(vim.fn.timer_stop, timer)
	end
end

local function parse_export(result)
	if type(result) ~= "table" then
		return "unavailable", nil
	end
	if result.code == nil then
		return "timeout", nil
	end
	if result.code ~= 0 then
		local stderr = type(result.stderr) == "string" and result.stderr or ""
		if stderr:find("blocked", 1, true) ~= nil then
			return "blocked", nil
		end
		return "unavailable", nil
	end
	if type(result.stdout) ~= "string" then
		return "malformed", nil
	end

	local ok, exported = pcall(vim.json.decode, result.stdout)
	if not ok or type(exported) ~= "table" then
		return "malformed", nil
	end
	for name in pairs(exported) do
		if type(name) ~= "string" then
			return "malformed", nil
		end
	end
	local path = exported.PATH
	if path == vim.NIL then
		path = nil
	elseif path ~= nil and type(path) ~= "string" then
		return "malformed", nil
	end
	return "loaded", path
end

local function process_options(cwd)
	return {
		cwd = cwd,
		env = copy_environment(startup_environment),
		text = true,
	}
end

local function run_export(cwd, callback)
	local ok, process = pcall(vim.system, { direnv_command, "export", "json" }, process_options(cwd), callback)
	if not ok or process == nil then
		return nil
	end
	return process
end

local function status_message(status)
	if status == "blocked" then
		return "Project environment is blocked; run `direnv allow` before starting Pi."
	end
	if status == "timeout" then
		return "Project environment timed out; inspect direnv and `.envrc` before starting Pi."
	end
	if status == "malformed" then
		return "Project environment returned invalid data; inspect direnv before starting Pi."
	end
	return "Project environment is unavailable; check the direnv executable and `.envrc` before starting Pi."
end

local function apply_result(status, path)
	if status == "loaded" and type(path) == "string" and path ~= "" then
		set_path(path)
		return
	end
	set_path(clean_path)
end

local function current_cwd()
	return canonical_path(vim.fn.getcwd())
end

local function apply_clean_baseline_if_current()
	local cwd = current_cwd()
	if cwd == nil then
		return
	end
	if envrc_directory(cwd) == nil then
		set_path(clean_path)
	end
end

local function start_clean_baseline()
	if clean_baseline_ready or clean_baseline_process ~= nil then
		return
	end

	local directory = vim.fn.tempname()
	if vim.fn.mkdir(directory, "p") ~= 1 then
		return
	end
	local process
	process = run_export(directory, function(result)
		if clean_baseline_process ~= process then
			return
		end
		clean_baseline_process = nil
		clean_baseline_ready = true
		vim.fn.delete(directory, "rf")
		local status, path = parse_export(result)
		if status == "loaded" and type(path) == "string" and path ~= "" then
			clean_path = path
			apply_clean_baseline_if_current()
		end
	end)
	clean_baseline_process = process
	if clean_baseline_process == nil then
		clean_baseline_ready = true
		vim.fn.delete(directory, "rf")
	end
end

local function synchronize_clean_baseline()
	if clean_baseline_ready then
		return
	end
	if clean_baseline_process ~= nil then
		stop_process(clean_baseline_process)
		clean_baseline_process = nil
	end

	local directory = vim.fn.tempname()
	if vim.fn.mkdir(directory, "p") ~= 1 then
		clean_baseline_ready = true
		return
	end
	local process = run_export(directory)
	if process == nil then
		clean_baseline_ready = true
		vim.fn.delete(directory, "rf")
		return
	end
	local ok, result = pcall(function()
		return process:wait(refresh_timeout_ms)
	end)
	if ok then
		local status, path = parse_export(result)
		if status == "timeout" then
			stop_process(process)
		elseif status == "loaded" and type(path) == "string" and path ~= "" then
			clean_path = path
		end
	else
		stop_process(process)
	end
	clean_baseline_ready = true
	vim.fn.delete(directory, "rf")
end

local function cancel_pending()
	generation = generation + 1
	if pending ~= nil then
		stop_process(pending.process)
		stop_timer(pending.timer)
		pending = nil
	end
end

local function refresh_result(token, cwd, result)
	if pending == nil or pending.token ~= token or generation ~= token then
		return
	end
	stop_timer(pending.timer)
	pending = nil
	if current_cwd() ~= cwd then
		return
	end

	local status, path = parse_export(result)
	apply_result(status, path)
	if status ~= "loaded" then
		vim.notify(status_message(status), vim.log.levels.WARN)
	end
end

function M.refresh(cwd)
	cwd = canonical_path(cwd or vim.fn.getcwd())
	if cwd == nil then
		return { ok = false, status = "unavailable" }
	end
	if synchronizing then
		queued_cwd = cwd
		return { ok = false, status = "pending" }
	end
	if pending ~= nil and pending.cwd == cwd then
		return { ok = false, status = "pending" }
	end

	cancel_pending()
	set_path(clean_path)
	if envrc_directory(cwd) == nil then
		return { ok = true, status = "missing", cwd = cwd }
	end

	local token = generation
	local process = run_export(cwd, function(result)
		refresh_result(token, cwd, result)
	end)
	if process == nil then
		vim.notify(status_message("unavailable"), vim.log.levels.WARN)
		return { ok = false, status = "unavailable", cwd = cwd }
	end
	pending = { cwd = cwd, process = process, token = token }
	pending.timer = vim.defer_fn(function()
		if pending == nil or pending.token ~= token or generation ~= token then
			return
		end
		stop_process(pending.process)
		pending = nil
		generation = generation + 1
		if current_cwd() == cwd then
			set_path(clean_path)
			vim.notify(status_message("timeout"), vim.log.levels.WARN)
		end
	end, refresh_timeout_ms)
	return { ok = false, status = "pending", cwd = cwd }
end

function M.synchronize(cwd)
	cwd = canonical_path(cwd or vim.fn.getcwd())
	if cwd == nil then
		set_path(clean_path)
		return { ok = false, status = "unavailable" }
	end
	if current_cwd() ~= cwd then
		return { ok = false, status = "cwd_changed", cwd = cwd }
	end
	if synchronizing then
		set_path(clean_path)
		return { ok = false, status = "pending", cwd = cwd }
	end

	synchronizing = true
	queued_cwd = nil
	cancel_pending()
	synchronize_clean_baseline()
	set_path(clean_path)

	local result
	if envrc_directory(cwd) == nil then
		result = { ok = true, status = "missing", cwd = cwd }
	else
		local process = run_export(cwd)
		if process == nil then
			result = { ok = false, status = "unavailable", cwd = cwd }
		else
			local ok, export_result = pcall(function()
				return process:wait(refresh_timeout_ms)
			end)
			if not ok then
				stop_process(process)
				result = { ok = false, status = "unavailable", cwd = cwd }
			else
				local status, path = parse_export(export_result)
				if status == "timeout" then
					stop_process(process)
				end
				result = {
					ok = status == "loaded",
					status = status,
					cwd = cwd,
				}
				apply_result(status, path)
			end
		end
	end

	if current_cwd() ~= cwd then
		set_path(clean_path)
		result = { ok = false, status = "cwd_changed", cwd = cwd }
	end
	synchronizing = false
	local next_cwd = queued_cwd
	queued_cwd = nil
	if next_cwd ~= nil and next_cwd == current_cwd() then
		vim.schedule(function()
			M.refresh(next_cwd)
		end)
	end
	return result
end

function M.failure_message(status)
	return status_message(status)
end

function M.setup()
	if setup_complete then
		return
	end
	setup_complete = true
	local group = vim.api.nvim_create_augroup("DirenvPathLoader", { clear = true })
	vim.api.nvim_create_autocmd("DirChanged", {
		group = group,
		callback = function()
			M.refresh(vim.fn.getcwd())
		end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "SessionLoadPost",
		callback = function()
			M.refresh(vim.fn.getcwd())
		end,
	})
	vim.api.nvim_create_autocmd("VimEnter", {
		group = group,
		once = true,
		callback = function()
			vim.schedule(function()
				start_clean_baseline()
				M.refresh(vim.fn.getcwd())
			end)
		end,
	})
end

return M
