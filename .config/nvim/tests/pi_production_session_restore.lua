local repo_root = assert(vim.env.REPO_ROOT)
local test_root = assert(vim.env.PI_PRODUCTION_TEST_ROOT)
local expected_specifier = assert(vim.env.PI_EXPECTED_NVIM_SESSION)
local expected_pane_id = assert(vim.env.PI_EXPECTED_HERDR_PANE_ID)
local pi_environment_capture = assert(vim.env.PI_ENVIRONMENT_CAPTURE)
local mini_sessions_path = assert(vim.env.PI_MINI_SESSIONS_PATH)
local order_log = assert(vim.env.PI_RESTORE_ORDER_LOG)

local function record_order(event)
	local file = assert(io.open(order_log, "a"))
	file:write(event, "\n")
	file:close()
end

_G.pi_record_restore_order = record_order
record_order("neovim-started")

assert(vim.env.HERDR_ENV == "1", "Herdr did not identify the restored Neovim process")
assert(vim.env.HERDR_PANE_ID == expected_pane_id, "Herdr restored Neovim in the wrong pane")
assert(vim.env.NVIM_SESSION == expected_specifier, "Herdr did not pass the exact Neovim session")
assert(vim.env.HERDR_MINI_SESSION_RESTORE == "1", "Herdr did not mark the Neovim session restore")
assert(vim.uv.fs_realpath(vim.fn.getcwd()) == repo_root, "Neovim did not inherit the restored pane cwd")
assert(vim.v.servername ~= "", "production Neovim startup did not create an RPC socket")

vim.opt.runtimepath:prepend(mini_sessions_path)
vim.opt.runtimepath:prepend(repo_root .. "/.config/nvim")

package.loaded["config.direnv"] = {
	synchronize = function(cwd)
		return { ok = true, status = "missing", cwd = cwd }
	end,
	failure_message = function()
		return "project environment fixture failure"
	end,
}
local session = require("utils.session")
local sessions = require("mini.sessions")
local target = session.resolve(repo_root, expected_specifier)
local pi_session_id = "production-restore-3.4"
local agent_dir = test_root .. "/pi-agent"
local encoded_repo = repo_root:gsub("^/", ""):gsub("[/:]", "-")
local pi_session_dir = agent_dir .. "/sessions/--" .. encoded_repo .. "--"
local pi_session_path = pi_session_dir .. "/2026-09-04T00-00-00-000Z_" .. pi_session_id .. ".jsonl"
vim.env.PI_CODING_AGENT_DIR = agent_dir
vim.env.PI_CODING_AGENT_SESSION_DIR = nil

vim.fn.mkdir(vim.fs.dirname(target.path), "p")
vim.fn.writefile({
	"lua pi_record_restore_order('nvim-session-loaded')",
	"let g:pi_production_session_loaded = 1",
}, target.path)
vim.fn.mkdir(pi_session_dir, "p")
vim.fn.writefile({
	vim.json.encode({
		type = "session",
		version = 3,
		id = pi_session_id,
		timestamp = "2026-09-04T00:00:00.000Z",
		cwd = repo_root,
	}),
	'{"type":"session_info","name":"production restore fixture"}',
}, pi_session_path)
session.set_metadata({
	opencode_session_id = "ses_production",
	opencode_terminal_open = true,
	pi_session_id = pi_session_id,
	pi_terminal_open = true,
}, target)
local pi_session_before = vim.fn.readfile(pi_session_path, "b")

local original_sessions_setup = sessions.setup
local original_sessions_read = sessions.read
sessions.setup = function(options)
	local pi_handler = vim.iter(vim.api.nvim_get_autocmds({
		event = "User",
		pattern = "SessionLoadPost",
	})):any(function(autocmd)
		return autocmd.group_name == "PiSessionPersistence"
	end)
	assert(pi_handler, "Pi restoration was not registered before mini.sessions setup")
	record_order("pi-handler-before-mini-setup")
	return original_sessions_setup(options)
end
sessions.read = function(name, options)
	assert(name == target.name, "production wiring read the wrong Neovim session")
	assert(vim.deep_equal(options, { force = true }), "production wiring changed session read options")
	record_order("nvim-session-read")
	return original_sessions_read(name, options)
end

local terminal_callbacks = {}
local terminal
terminal = {
	buf_valid = function()
		return terminal.buf ~= nil and vim.api.nvim_buf_is_valid(terminal.buf)
	end,
	close = function(self)
		return self
	end,
	on = function(_, event, callback)
		terminal_callbacks[event] = callback
	end,
	valid = function()
		return true
	end,
}
local opened_terminal
package.loaded["snacks.terminal"] = {
	open = function(command, options)
		record_order("pi-exact-resume")
		local output = vim.fn.system(command)
		assert(vim.v.shell_error == 0, "restored Pi command failed: " .. output)
		terminal.buf = vim.api.nvim_create_buf(false, true)
		opened_terminal = { command = command, options = options }
		options.win.on_buf(terminal)
		return terminal
	end,
}

local original_system = vim.system
rawset(vim, "system", function(command, options)
	assert(vim.deep_equal(options, { detach = true }), "Herdr pane update was not detached")
	assert(command[1] == "herdr" and command[2] == "pane", "unexpected process during restoration")
	assert(command[4] == expected_pane_id, "Neovim reported the wrong Herdr pane")
	if command[3] == "rename" then
		assert(command[5] == "nvim", "Neovim restored with the wrong pane label")
		record_order("nvim-herdr-pane-rename")
	elseif command[3] == "report-metadata" then
		assert(command[8] == "nvim_session=" .. expected_specifier, "Neovim reported the wrong session token")
		record_order("nvim-herdr-session-report")
	else
		error("unexpected Herdr pane operation: " .. tostring(command[3]))
	end
	return {}
end)

local registration = dofile(repo_root .. "/.config/nvim/lua/plugins/workflow/session.lua")
assert(type(registration) == "table" and type(registration[1]) == "table", "session plugin was not registered")
assert(registration[1].name == "mini.sessions", "wrong production session plugin was loaded")
assert(registration[1].startup == true, "session restoration was not a startup plugin")
assert(registration[1].condition() == true, "production session plugin was disabled for the Herdr restore")
registration[1].setup()
sessions.setup = original_sessions_setup
record_order("session-workflow-setup")
assert(vim.env.NVIM_SESSION == nil, "production setup did not consume NVIM_SESSION")
assert(session.get_current() ~= nil, "production setup did not select a Neovim session")
assert(session.get_current().path == target.path, "production setup selected the wrong Neovim session")

local pre_enter_metadata = session.get_metadata(target)
assert(pre_enter_metadata.restore_pending == nil, "fixture started with stale Herdr restore state")
record_order("nvim-vimenter")
vim.api.nvim_exec_autocmds("VimEnter", {})
assert(
	vim.wait(1000, function()
		return opened_terminal ~= nil
	end, 10),
	"production wiring did not resume Pi after Neovim session load"
)
sessions.read = original_sessions_read
rawset(vim, "system", original_system)

assert(vim.g.pi_production_session_loaded == 1, "Neovim did not source the restored session")
local launch_id = assert(opened_terminal.command:match("PI_NVIM_LAUNCH_ID='([a-f0-9]+)'"))
assert(#launch_id == 32, "production wiring did not assign a bounded Pi launch ID")
assert(
	opened_terminal.command
		== "env -u HERDR_PANE_ID PI_NVIM_HERDR_PANE_ID="
			.. vim.fn.shellescape(expected_pane_id)
			.. " PI_IMAGE_PROTOCOL=none PI_NVIM_LAUNCH_ID="
			.. vim.fn.shellescape(launch_id)
			.. " PI_NVIM_SOCKET="
			.. vim.fn.shellescape(vim.v.servername)
			.. " pi --session-dir "
			.. vim.fn.shellescape(pi_session_dir)
			.. " --session "
			.. vim.fn.shellescape(pi_session_id),
	"production wiring did not resume the exact Pi session"
)
assert(opened_terminal.command:find("--session-id", 1, true) == nil, "production restore created a Pi session")
assert(opened_terminal.options.cwd == repo_root, "production restore launched Pi outside the restored worktree")
assert(vim.b[terminal.buf].is_pi_terminal == true, "production restore did not mark the Pi terminal")
assert(
	vim.deep_equal(vim.fn.readfile(pi_environment_capture), {
		"HERDR_ENV=1",
		"HERDR_PANE_ID=",
		"HERDR_SOCKET_PATH=" .. vim.env.HERDR_SOCKET_PATH,
		"PI_NVIM_HERDR_PANE_ID=" .. expected_pane_id,
		"PI_IMAGE_PROTOCOL=none",
		"PI_NVIM_LAUNCH_ID=" .. launch_id,
		"PI_NVIM_SOCKET=" .. vim.v.servername,
		"ARG1=--session-dir",
		"ARG2=" .. pi_session_dir,
		"ARG3=--session",
		"ARG4=" .. pi_session_id,
	}),
	"restored Pi did not inherit the owning Herdr pane and exact session arguments"
)

local expected_order = {
	"herdr-session-report",
	"herdr-pane-run",
	"neovim-started",
	"pi-handler-before-mini-setup",
	"session-workflow-setup",
	"nvim-vimenter",
	"nvim-herdr-pane-rename",
	"nvim-herdr-session-report",
	"nvim-session-read",
	"nvim-session-loaded",
	"pi-exact-resume",
}
assert(
	vim.deep_equal(vim.fn.readfile(order_log), expected_order),
	"production restoration order changed: " .. vim.inspect(vim.fn.readfile(order_log))
)

local restored_metadata = session.get_metadata(target)
assert(restored_metadata.restore_pending == true, "Neovim did not retain Herdr restore ownership")
assert(restored_metadata.herdr_managed == true, "Neovim did not mark the session as Herdr-managed")
assert(restored_metadata.herdr_pane_id == expected_pane_id, "restored metadata recorded the wrong Herdr pane")
assert(restored_metadata.specifier == expected_specifier, "restored metadata recorded the wrong Neovim session")
assert(restored_metadata.pi_session_id == pi_session_id, "Pi session identity changed during restoration")
assert(restored_metadata.pi_terminal_open == true, "Pi terminal state changed during restoration")
assert(
	restored_metadata.opencode_session_id == "ses_production",
	"OpenCode session identity changed during restoration"
)
assert(restored_metadata.opencode_terminal_open == true, "OpenCode terminal state changed during restoration")
assert(
	vim.deep_equal(vim.fn.readfile(pi_session_path, "b"), pi_session_before),
	"production validation changed the Pi session file"
)

terminal_callbacks.TermClose()
