local repo_root = assert(vim.env.REPO_ROOT)
local original_system = vim.system
local original_defer_fn = vim.defer_fn
local original_cwd = vim.fn.getcwd()
local original_path = vim.env.PATH
local original_active = vim.env.DIRENV_ACTIVE
local original_diff = vim.env.DIRENV_DIFF
local original_dir = vim.env.DIRENV_DIR

local test_root = vim.fn.tempname()
vim.fn.mkdir(test_root, "p")
test_root = vim.uv.fs_realpath(test_root) or test_root
local project_a = test_root .. "/project-a"
local project_b = test_root .. "/project-b"
local unchanged = test_root .. "/unchanged"
local absent_path = test_root .. "/absent-path"
local null_path = test_root .. "/null-path"
local timed_out = test_root .. "/timed-out"
local missing = test_root .. "/missing"
for _, directory in ipairs({ project_a, project_b, unchanged, absent_path, null_path, timed_out, missing }) do
	vim.fn.mkdir(directory, "p")
end
vim.fn.mkdir(test_root .. "/.git", "p")
for _, directory in ipairs({ project_a, project_b, unchanged, absent_path, null_path, timed_out }) do
	vim.fn.writefile({ "# fixture; never executed" }, directory .. "/.envrc")
end

vim.env.PATH = "/startup/path"
vim.env.DIRENV_ACTIVE = project_a .. ":" .. project_b
vim.env.DIRENV_DIFF = "inherited-diff"
vim.env.DIRENV_DIR = "-/inherited/project"
vim.cmd("cd " .. vim.fn.fnameescape(project_a))

local requests, callbacks, deadlines = {}, {}, {}
local results = {
	[project_a] = { code = 0, stdout = '{"PATH":"/project/a/bin"}' },
	[project_b] = { code = 0, stdout = '{"PATH":"/project/b/bin"}' },
	[unchanged] = { code = 0, stdout = "" },
	[absent_path] = { code = 0, stdout = '{"PROJECT_VALUE":"ignored"}' },
	[null_path] = { code = 0, stdout = '{"PATH":null}' },
	[timed_out] = { code = nil, stdout = "", stderr = "" },
}

vim.defer_fn = function(callback, timeout)
	assert(timeout == 5000, "loader changed the export deadline")
	local timer = { closed = false }
	function timer:stop() end
	function timer:close()
		self.closed = true
	end
	function timer:is_closing()
		return self.closed
	end
	-- Match vim.defer_fn's one-shot timer cleanup before invoking the callback.
	table.insert(deadlines, {
		timer = timer,
		callback = function()
			timer:stop()
			timer:close()
			callback()
		end,
	})
	return timer
end

vim.system = function(command, options, callback)
	assert(command[2] == "export" and command[3] == "json", "loader changed the direnv export command")
	assert(options.env.PATH == "/startup/path", "export did not use the startup environment")
	assert(options.env.DIRENV_DIFF == "inherited-diff", "loader dropped inherited direnv metadata")
	assert(options.env.DIRENV_DIR == "-/inherited/project", "loader dropped inherited direnv directory")
	local result = vim.deepcopy(results[options.cwd] or { code = 0, stdout = '{"PATH":"/clean/path"}' })
	local process = {
		kill = function(self)
			self.killed = true
		end,
	}
	table.insert(requests, { cwd = options.cwd, callback = callback, process = process })
	if callback ~= nil then
		table.insert(callbacks, { callback = callback, result = result, process = process })
	end
	return process
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

package.loaded["config.direnv"] = nil
local loader = dofile(repo_root .. "/.config/nvim/lua/config/direnv.lua")
loader.setup()
local initial_callbacks = #callbacks
vim.api.nvim_exec_autocmds("VimEnter", {})
assert(
	vim.wait(1000, function()
		return #callbacks == initial_callbacks + 2
	end),
	"startup did not start baseline and project exports"
)
complete_export(initial_callbacks + 1)
complete_export(initial_callbacks + 2)
assert(vim.env.PATH == "/project/a/bin", "asynchronous startup did not apply the project PATH")
assert(requests[initial_callbacks + 2].cwd == project_a, "DIRENV_ACTIVE directory list bypassed direnv export")

local autocmds = vim.api.nvim_get_autocmds({ group = "DirenvPathLoader" })
assert(
	vim.iter(autocmds):any(function(autocmd)
		return autocmd.event == "DirChanged"
	end),
	"loader did not register cwd refresh"
)
vim.api.nvim_del_augroup_by_name("DirenvPathLoader")

local function refresh(directory)
	vim.cmd("cd " .. vim.fn.fnameescape(directory))
	local result = loader.refresh(directory)
	assert(result.status == "pending", "refresh did not run asynchronously")
	return #callbacks
end

local callback_index = refresh(unchanged)
assert(vim.env.PATH == "/clean/path", "refresh did not restore the clean baseline before exporting")
complete_export(callback_index)
assert(vim.env.PATH == "/startup/path", "empty export did not preserve subprocess startup PATH")

callback_index = refresh(absent_path)
complete_export(callback_index)
assert(vim.env.PATH == "/startup/path", "omitted PATH did not preserve subprocess startup PATH")

callback_index = refresh(null_path)
complete_export(callback_index)
assert(vim.env.PATH == nil, "explicit null PATH was not treated as deletion")

vim.cmd("cd " .. vim.fn.fnameescape(missing))
local missing_result = loader.refresh(missing)
assert(
	missing_result.status == "missing" and vim.env.PATH == "/clean/path",
	"missing envrc did not restore clean baseline"
)

local stale_index = refresh(project_a)
local stale_process = callbacks[stale_index].process
local stale_deadline = deadlines[#deadlines].timer
local current_index = refresh(project_b)
assert(stale_process.killed == true, "cwd change did not cancel the previous export")
assert(stale_deadline:is_closing(), "cwd change left the previous deadline active")
complete_export(current_index)
assert(vim.env.PATH == "/project/b/bin", "current cwd export did not apply")
complete_export(stale_index)
assert(vim.env.PATH == "/project/b/bin", "stale cwd callback overwrote the current PATH")

local timeout_index = refresh(timed_out)
local timeout_deadline = deadlines[#deadlines]
timeout_deadline.callback()
assert(callbacks[timeout_index].process.killed == true, "deadline did not terminate the export")
assert(vim.env.PATH == "/clean/path", "timeout did not restore clean baseline")
assert(timeout_deadline.timer:is_closing(), "timeout left its deadline active")

vim.cmd("cd " .. vim.fn.fnameescape(original_cwd))
rawset(vim, "system", original_system)
rawset(vim, "defer_fn", original_defer_fn)
vim.env.PATH = original_path
vim.env.DIRENV_ACTIVE = original_active
vim.env.DIRENV_DIFF = original_diff
vim.env.DIRENV_DIR = original_dir
vim.fn.delete(test_root, "rf")
