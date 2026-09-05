local repo_root = assert(vim.env.REPO_ROOT)
local original_system = vim.system
local original_defer_fn = vim.defer_fn
local original_cwd = vim.fn.getcwd()
local original_path = vim.env.PATH
local original_secret = vim.env.DIRENV_TEST_SECRET
local original_active = vim.env.DIRENV_ACTIVE
local original_diff = vim.env.DIRENV_DIFF
local original_dir = vim.env.DIRENV_DIR

local test_root = vim.fn.tempname()
local project_a = test_root .. "/project-a"
local project_b = test_root .. "/project-b"
local missing = test_root .. "/missing"
local null_path = test_root .. "/null-path"
local absent_path = test_root .. "/absent-path"
local blocked = test_root .. "/blocked"
local unavailable = test_root .. "/unavailable"
local malformed = test_root .. "/malformed"
local timed_out = test_root .. "/timed-out"
for _, directory in ipairs({
	project_a,
	project_b,
	missing,
	null_path,
	absent_path,
	blocked,
	unavailable,
	malformed,
	timed_out,
}) do
	vim.fn.mkdir(directory, "p")
end
vim.fn.mkdir(test_root .. "/.git", "p")
for _, directory in ipairs({ project_a, project_b, null_path, absent_path, blocked, unavailable, malformed, timed_out }) do
	vim.fn.writefile({ "# fixture; never executed" }, directory .. "/.envrc")
end

vim.env.PATH = "/baseline/path"
vim.env.DIRENV_TEST_SECRET = "inherited-secret"
vim.env.DIRENV_ACTIVE = "/inherited/project"
vim.env.DIRENV_DIFF = "inherited-diff"
vim.env.DIRENV_DIR = "-/inherited/project"
vim.cmd("cd " .. vim.fn.fnameescape(project_a))

local requests = {}
local callbacks = {}
local deadlines = {}
rawset(vim, "defer_fn", function(callback, timeout)
	local timer = original_defer_fn(callback, timeout)
	table.insert(deadlines, timer)
	return timer
end)
local results = {
	[project_a] = { code = 0, stdout = '{"PATH":"/project/a/bin","PROJECT_SECRET":"do-not-copy"}' },
	[project_b] = { code = 0, stdout = '{"PATH":"/project/b/bin"}' },
	[null_path] = { code = 0, stdout = '{"PATH":null,"PROJECT_SECRET":"do-not-copy"}' },
	[absent_path] = { code = 0, stdout = '{"PROJECT_SECRET":"do-not-copy"}' },
	[blocked] = { code = 1, stdout = "", stderr = "direnv: error .envrc is blocked" },
	[unavailable] = { code = 1, stdout = "", stderr = "direnv failed" },
	[malformed] = { code = 0, stdout = "not json" },
	[timed_out] = { code = nil, stdout = "", stderr = "" },
}

local function copy_result(result)
	return vim.deepcopy(result)
end

local function complete_export(index)
	local completion = assert(callbacks[index or #callbacks])
	local finished, failure = false, nil
	local timer = assert(vim.uv.new_timer())
	timer:start(0, 0, function()
		timer:stop()
		timer:close()
		assert(vim.in_fast_event(), "process exit fixture did not run in a fast event")
		local ok, err = pcall(completion.callback, completion.result)
		failure = not ok and err or nil
		-- Drain editor work scheduled by the exit callback before checking its effects.
		vim.schedule(function()
			finished = true
		end)
	end)
	assert(
		vim.wait(1000, function()
			return finished
		end),
		"process exit callback did not finish"
	)
	assert(failure == nil, "process exit callback used an unsafe editor API: " .. tostring(failure))
end

rawset(vim, "system", function(command, options, callback)
	assert(command[2] == "export" and command[3] == "json", "loader changed the direnv export command")
	assert(type(options.cwd) == "string", "loader did not provide a process cwd")
	assert(options.text == true, "loader did not request text output")
	assert(options.env.DIRENV_DIFF == "inherited-diff", "loader dropped inherited direnv metadata")
	assert(options.env.DIRENV_DIR == "-/inherited/project", "loader dropped the inherited direnv directory")
	table.insert(requests, { cwd = options.cwd, env = options.env, callback = callback })
	local result = copy_result(results[options.cwd] or { code = 0, stdout = '{"PATH":"/clean/path"}' })
	local process = {
		kill = function(self)
			self.killed = true
		end,
		wait = function()
			return result
		end,
	}
	if callback ~= nil then
		table.insert(callbacks, { callback = callback, result = result, process = process })
	end
	return process
end)

package.loaded["config.direnv"] = nil
local loader = dofile(repo_root .. "/.config/nvim/lua/config/direnv.lua")
local baseline_request_count = #requests
local first = assert(loader.synchronize(project_a))
assert(first.ok == true and first.status == "loaded", "approved environment did not load")
assert(vim.env.PATH == "/project/a/bin", "approved project PATH was not applied")
assert(vim.env.DIRENV_TEST_SECRET == "inherited-secret", "loader copied a project variable into Neovim")
assert(requests[baseline_request_count + 1].env.PATH == "/baseline/path", "resolver reused a project PATH")

vim.cmd("cd " .. vim.fn.fnameescape(project_b))
local second = assert(loader.synchronize(project_b))
assert(second.ok == true and second.status == "loaded", "second approved environment did not load")
assert(vim.env.PATH == "/project/b/bin", "project PATH was appended or left stale")

vim.cmd("cd " .. vim.fn.fnameescape(missing))
local restored = assert(loader.synchronize(missing))
assert(restored.ok == true and restored.status == "missing", "missing envrc was not treated as baseline")
assert(vim.env.PATH == "/clean/path", "missing envrc did not restore the clean baseline")

for _, directory in ipairs({ null_path, absent_path }) do
	vim.cmd("cd " .. vim.fn.fnameescape(directory))
	local result = assert(loader.synchronize(directory))
	assert(result.ok == true and result.status == "loaded", "PATH-less export was rejected")
	assert(vim.env.PATH == "/clean/path", "PATH-less export did not restore the clean baseline")
	assert(vim.env.DIRENV_TEST_SECRET == "inherited-secret", "PATH-less export changed another variable")
end

for directory, expected_status in pairs({
	[blocked] = "blocked",
	[unavailable] = "unavailable",
	[malformed] = "malformed",
	[timed_out] = "timeout",
}) do
	vim.cmd("cd " .. vim.fn.fnameescape(directory))
	local result = assert(loader.synchronize(directory))
	assert(result.ok == false and result.status == expected_status, "unexpected direnv failure status")
	assert(vim.env.PATH == "/clean/path", "direnv failure retained a stale project PATH")
end

vim.cmd("cd " .. vim.fn.fnameescape(project_a))
local old_refresh = loader.refresh(project_a)
assert(old_refresh.ok == false and old_refresh.status == "pending", "refresh did not start asynchronously")
vim.cmd("cd " .. vim.fn.fnameescape(project_b))
local new_refresh = loader.refresh(project_b)
assert(new_refresh.ok == false and new_refresh.status == "pending", "second refresh was not coalesced")
assert(#callbacks >= 2, "refresh did not register both fake process callbacks")
complete_export()
assert(vim.env.PATH == "/project/b/bin", "current refresh did not apply its project PATH")
complete_export(#callbacks - 1)
assert(vim.env.PATH == "/project/b/bin", "stale refresh overwrote the current project PATH")
assert(deadlines[1]:is_closing(), "cancelled refresh left its deadline active")
assert(deadlines[2]:is_closing(), "completed refresh left its deadline active")

loader.setup()
local autocmds = vim.api.nvim_get_autocmds({ group = "DirenvPathLoader" })
local events = {}
for _, autocmd in ipairs(autocmds) do
	events[autocmd.event] = true
end
assert(
	events.VimEnter and events.DirChanged and events.User,
	"loader did not register startup, cwd, and session events"
)
assert(
	vim.iter(autocmds):any(function(autocmd)
		return autocmd.event == "User" and autocmd.pattern == "SessionLoadPost"
	end),
	"loader did not refresh after session load"
)
local callback_count = #callbacks
vim.api.nvim_exec_autocmds("User", { pattern = "SessionLoadPost" })
assert(#callbacks == callback_count + 1, "session load did not refresh the project environment")
complete_export()
vim.cmd("cd " .. vim.fn.fnameescape(missing))
assert(vim.env.PATH == "/clean/path", "directory change did not restore the clean baseline")

vim.api.nvim_del_augroup_by_name("DirenvPathLoader")
vim.env.PATH = "/baseline/path"
local startup_loader = dofile(repo_root .. "/.config/nvim/lua/config/direnv.lua")
startup_loader.setup()
local startup_callback_count = #callbacks
vim.api.nvim_exec_autocmds("VimEnter", {})
assert(
	vim.wait(1000, function()
		return #callbacks == startup_callback_count + 1
	end),
	"startup did not request the clean baseline"
)
local baseline_directory = requests[#requests].cwd
assert(vim.uv.fs_stat(baseline_directory) ~= nil, "baseline export did not create its temporary directory")
complete_export()
assert(vim.uv.fs_stat(baseline_directory) == nil, "baseline exit did not clean up its temporary directory")
assert(vim.env.PATH == "/clean/path", "asynchronous baseline exit did not apply the clean PATH")

vim.api.nvim_del_augroup_by_name("DirenvPathLoader")
vim.cmd("cd " .. vim.fn.fnameescape(original_cwd))
rawset(vim, "system", original_system)
rawset(vim, "defer_fn", original_defer_fn)
vim.env.PATH = original_path
vim.env.DIRENV_TEST_SECRET = original_secret
vim.env.DIRENV_ACTIVE = original_active
vim.env.DIRENV_DIFF = original_diff
vim.env.DIRENV_DIR = original_dir
vim.fn.delete(test_root, "rf")
