local repo_root = assert(vim.env.REPO_ROOT)
local test_root = vim.fn.tempname()
local agent_dir = test_root .. "/pi-agent"
local encoded_repo = repo_root:gsub("^/", ""):gsub("[/:]", "-")
local session_dir = agent_dir .. "/sessions/--" .. encoded_repo .. "--"
local metadata_path = test_root .. "/nvim/session.json"
local sibling_worktree = test_root .. "/sibling"
local encoded_sibling = sibling_worktree:gsub("^/", ""):gsub("[/:]", "-")
local sibling_session_dir = agent_dir .. "/sessions/--" .. encoded_sibling .. "--"
vim.fn.mkdir(session_dir, "p")
vim.fn.mkdir(sibling_session_dir, "p")
vim.fn.mkdir(sibling_worktree, "p")

local previous_agent_dir = vim.env.PI_CODING_AGENT_DIR
local previous_session_dir = vim.env.PI_CODING_AGENT_SESSION_DIR
local previous_herdr_env = vim.env.HERDR_ENV
local previous_herdr_pane_id = vim.env.HERDR_PANE_ID
local previous_pi_herdr_pane_id = vim.env.PI_NVIM_HERDR_PANE_ID
vim.env.PI_CODING_AGENT_DIR = agent_dir
vim.env.PI_CODING_AGENT_SESSION_DIR = nil
vim.env.HERDR_ENV = nil
vim.env.HERDR_PANE_ID = nil
vim.env.PI_NVIM_HERDR_PANE_ID = nil

local nvim_session = {
	cwd = repo_root,
	metadata_path = metadata_path,
}
local session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
session.set_current(nvim_session)
package.loaded["utils.session"] = session
package.loaded["plugins.ai.pi.session"] = dofile(repo_root .. "/.config/nvim/lua/plugins/ai/pi/session.lua")
package.loaded["config.direnv"] = {
	synchronize = function(cwd)
		return { ok = true, status = "missing", cwd = cwd }
	end,
	failure_message = function()
		return "project environment fixture failure"
	end,
}
package.loaded["plugins.ai.pi.bridge"] = {
	record_source_context = function()
		return true
	end,
}

local notifications = {}
local original_notify = vim.notify
rawset(vim, "notify", function(message, level)
	table.insert(notifications, { message = message, level = level })
end)

local terminal_callbacks = {}
local terminal = {
	buf = vim.api.nvim_create_buf(false, true),
	buf_valid = function()
		return true
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
local opened = {}
local fail_open = false
package.loaded["snacks.terminal"] = {
	open = function(command, options)
		if fail_open then
			error("terminal fixture failure")
		end
		table.insert(opened, { command = command, options = options })
		options.win.on_buf(terminal)
		return terminal
	end,
}

local function write_session(session_id, cwd, header, directory)
	directory = directory or session_dir
	vim.fn.mkdir(directory, "p")
	local path = directory .. "/2026-09-04T00-00-00-000Z_" .. session_id .. ".jsonl"
	header = header
		or {
			type = "session",
			version = 3,
			id = session_id,
			timestamp = "2026-09-04T00:00:00.000Z",
			cwd = cwd,
		}
	vim.fn.writefile({ vim.json.encode(header), '{"type":"session_info","name":"restore fixture"}' }, path)
	return path
end

local function set_metadata(session_id, is_open)
	session.set_metadata({
		opencode_session_id = "ses_exact",
		opencode_terminal_open = true,
		pi_session_id = session_id,
		pi_terminal_open = is_open,
	}, nvim_session)
end

local function assert_metadata_unchanged(before, message)
	assert(vim.deep_equal(session.get_metadata(nvim_session), before), message)
end

local function has_notification(fragment)
	return vim.iter(notifications):any(function(notification)
		return notification.message:find(fragment, 1, true) ~= nil
	end)
end

local function assert_exact_command(command, directory, session_id, message)
	local launch_id = command:match("^PI_NVIM_LAUNCH_ID='([a-f0-9]+)'")
	assert(type(launch_id) == "string" and #launch_id == 32, message .. ": invalid launch ID")
	assert(
		command
			== "PI_NVIM_LAUNCH_ID="
				.. vim.fn.shellescape(launch_id)
				.. " PI_NVIM_SOCKET="
				.. vim.fn.shellescape(vim.v.servername)
				.. " pi --session-dir "
				.. vim.fn.shellescape(directory)
				.. " --session "
				.. vim.fn.shellescape(session_id),
		message
	)
end

local function assert_fresh_command(command, message)
	local launch_id = command:match("^PI_NVIM_LAUNCH_ID='([a-f0-9]+)'")
	assert(type(launch_id) == "string" and #launch_id == 32, message .. ": invalid launch ID")
	assert(
		command
			== "PI_NVIM_LAUNCH_ID="
				.. vim.fn.shellescape(launch_id)
				.. " PI_NVIM_SOCKET="
				.. vim.fn.shellescape(vim.v.servername)
				.. " pi",
		message .. ": fresh Pi command was not session-neutral"
	)
	return launch_id
end

local exact_id = "exact-session-3.3"
local exact_path = write_session(exact_id, repo_root)
set_metadata(exact_id, true)
local exact_metadata = session.get_metadata(nvim_session)
local exact_file_before = vim.fn.readfile(exact_path, "b")

local pi = dofile(repo_root .. "/.config/nvim/lua/plugins/ai/pi/init.lua")
pi.setup()
pi.setup()
vim.api.nvim_exec_autocmds("User", { pattern = "SessionLoadPost" })
assert(#opened == 1, "SessionLoadPost did not restore exactly one Pi terminal")
assert_exact_command(
	opened[1].command,
	session_dir,
	exact_id,
	"restored Pi command did not use the exact session and directory"
)
assert(opened[1].command:find("--session-id", 1, true) == nil, "restore used the session-creation flag")
assert(opened[1].options.cwd == repo_root, "restored Pi terminal did not use the saved worktree")
assert(vim.b[terminal.buf].is_pi_terminal == true, "restored Pi terminal was not marked")
assert_metadata_unchanged(exact_metadata, "exact restoration changed Neovim metadata")
assert(vim.deep_equal(vim.fn.readfile(exact_path, "b"), exact_file_before), "validation changed the Pi session file")
terminal_callbacks.TermClose()

local override_id = "override-session-3.3"
local override_dir = test_root .. "/override-sessions"
local override_path = write_session(override_id, repo_root, nil, override_dir)
local override_file_before = vim.fn.readfile(override_path, "b")
vim.env.PI_CODING_AGENT_SESSION_DIR = override_dir
set_metadata(override_id, true)
local override_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == true, "session directory override did not restore Pi")
assert(#opened == 2, "session directory override opened the wrong number of terminals")
assert(
	opened[2].command:find("--session-dir " .. vim.fn.shellescape(override_dir), 1, true) ~= nil,
	"restore ignored PI_CODING_AGENT_SESSION_DIR"
)
assert_metadata_unchanged(override_metadata, "session-directory restoration changed metadata")
assert(
	vim.deep_equal(vim.fn.readfile(override_path, "b"), override_file_before),
	"session-directory validation changed the Pi session file"
)
terminal_callbacks.TermClose()
vim.env.PI_CODING_AGENT_SESSION_DIR = nil

local settings_id = "settings-session-3.3"
local settings_dir = test_root .. "/settings-sessions"
local settings_path = write_session(settings_id, repo_root, nil, settings_dir)
local settings_file_before = vim.fn.readfile(settings_path, "b")
vim.fn.writefile({ vim.json.encode({ sessionDir = settings_dir }) }, agent_dir .. "/settings.json")
set_metadata(settings_id, true)
local settings_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == true, "configured session directory did not restore Pi")
assert(#opened == 3, "configured session directory opened the wrong number of terminals")
assert(
	opened[3].command:find("--session-dir " .. vim.fn.shellescape(settings_dir), 1, true) ~= nil,
	"restore ignored settings.json sessionDir"
)
assert_metadata_unchanged(settings_metadata, "configured-directory restoration changed metadata")
assert(
	vim.deep_equal(vim.fn.readfile(settings_path, "b"), settings_file_before),
	"configured-directory validation changed the Pi session file"
)
terminal_callbacks.TermClose()

local project_worktree = test_root .. "/project"
local project_settings_dir = project_worktree .. "/project-sessions"
local project_id = "project-settings-session-3.3"
vim.fn.mkdir(project_worktree .. "/.pi", "p")
vim.fn.writefile({ vim.json.encode({ sessionDir = "project-sessions" }) }, project_worktree .. "/.pi/settings.json")
local project_path = write_session(project_id, project_worktree, nil, project_settings_dir)
local project_file_before = vim.fn.readfile(project_path, "b")
nvim_session.cwd = project_worktree
vim.cmd("cd " .. vim.fn.fnameescape(project_worktree))
set_metadata(project_id, true)
local project_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == true, "project session directory did not restore Pi")
assert(#opened == 4, "project session directory opened the wrong number of terminals")
assert(
	opened[4].command:find("--session-dir " .. vim.fn.shellescape(project_settings_dir), 1, true) ~= nil,
	"restore ignored project settings.json sessionDir"
)
assert(opened[4].options.cwd == project_worktree, "project-configured restore used the wrong worktree")
assert_metadata_unchanged(project_metadata, "project-configured restoration changed metadata")
assert(
	vim.deep_equal(vim.fn.readfile(project_path, "b"), project_file_before),
	"project-configured validation changed the Pi session file"
)
terminal_callbacks.TermClose()
vim.cmd("cd " .. vim.fn.fnameescape(repo_root))
nvim_session.cwd = repo_root

notifications = {}
set_metadata(exact_id, false)
local manual_metadata = session.get_metadata(nvim_session)
local manual_terminal = pi.start()
assert(manual_terminal == terminal, "PiStart did not resume the MiniSessions-associated Pi session")
assert(#opened == 5, "PiStart opened the wrong number of terminals")
assert_exact_command(
	opened[5].command,
	session_dir,
	exact_id,
	"PiStart did not use the exact saved session and directory"
)
assert(opened[5].options.cwd == repo_root, "PiStart did not use the saved worktree")
assert_metadata_unchanged(manual_metadata, "manual Pi resume changed Neovim metadata")
assert(vim.deep_equal(vim.fn.readfile(exact_path, "b"), exact_file_before), "manual Pi resume changed the session file")
terminal_callbacks.TermClose()

notifications = {}
set_metadata(exact_id, false)
local closed_metadata = session.get_metadata(nvim_session)
local opened_before = #opened
assert(pi.restore() == false, "closed Pi terminal state requested restoration")
assert(#opened == opened_before, "closed Pi terminal state opened Pi")
assert(#notifications == 0, "closed Pi terminal state reported a failure")
assert_metadata_unchanged(closed_metadata, "closed-terminal rejection changed metadata")

notifications = {}
set_metadata("invalid/session", true)
local invalid_id_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == false, "invalid Pi session ID requested restoration")
assert(#opened == opened_before, "invalid Pi session ID opened Pi")
assert(has_notification("saved session ID is invalid"), "invalid Pi session ID was not reported")
assert_metadata_unchanged(invalid_id_metadata, "invalid-ID rejection changed metadata")

local missing_id = "missing-session-3.3"
write_session("newer-unrelated-session", repo_root)

notifications = {}
set_metadata(missing_id, true)
local fresh_failure_metadata = session.get_metadata(nvim_session)
fail_open = true
assert(pi.restore() == false, "failed fresh Pi fallback reported success")
fail_open = false
assert(#opened == opened_before, "failed fresh Pi fallback recorded an open terminal")
assert(not has_notification("started a new Pi session"), "failed fallback reported a new Pi session")
assert(has_notification("Pi terminal could not be opened"), "fresh Pi fallback failure was not reported")
assert_metadata_unchanged(fresh_failure_metadata, "fresh fallback failure changed metadata")

notifications = {}
set_metadata(missing_id, true)
local missing_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == true, "missing Pi session did not start a fresh terminal")
assert(#opened == opened_before + 1, "missing Pi session opened the wrong number of terminals")
local fresh_launch_id = assert_fresh_command(opened[#opened].command, "missing Pi session fallback")
assert(opened[#opened].options.cwd == repo_root, "fresh Pi fallback used the wrong worktree")
assert(has_notification("started a new Pi session"), "missing Pi session recovery was not reported")
assert(not has_notification("Pi session was not restored"), "successful recovery still reported a restore failure")
assert_metadata_unchanged(missing_metadata, "fresh fallback replaced metadata before Pi binding")

local replacement_id = "replacement-session-3.3"
local replacement_binding = pi.bind_session({
	sessionId = replacement_id,
	launchId = fresh_launch_id,
	channelId = 21,
	cwd = repo_root,
	editorPid = vim.fn.getpid(),
})
assert(type(replacement_binding) == "table", "Pi fallback did not bind Pi's actual session ID")
local replacement_metadata = session.get_metadata(nvim_session)
assert(replacement_metadata.pi_session_id == replacement_id, "Pi fallback binding did not persist the replacement ID")
assert(replacement_metadata.pi_terminal_open == true, "Pi fallback binding did not persist the open state")
assert(replacement_metadata.opencode_session_id == "ses_exact", "Pi fallback binding changed OpenCode session metadata")
assert(replacement_metadata.opencode_terminal_open == true, "Pi fallback binding changed OpenCode terminal metadata")
local reloaded_session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
local reloaded_metadata = reloaded_session.get_metadata(nvim_session)
assert(reloaded_metadata.pi_session_id == replacement_id, "bound Pi ID did not survive metadata reload")
assert(reloaded_metadata.pi_terminal_open == true, "bound Pi open state did not survive metadata reload")
write_session(replacement_id, repo_root)
terminal_callbacks.TermClose()
assert(session.get_metadata(nvim_session).pi_session_id == replacement_id, "closing Pi discarded the replacement ID")
assert(session.get_metadata(nvim_session).pi_terminal_open == false, "closing Pi did not persist the replacement state")
local resumed_replacement_metadata = session.get_metadata(nvim_session)
assert(pi.start() == terminal, "PiStart did not restore the newly bound Pi session")
assert(#opened == opened_before + 2, "PiStart opened the wrong number of terminals for the replacement")
assert_exact_command(
	opened[#opened].command,
	session_dir,
	replacement_id,
	"PiStart did not target the newly persisted Pi session"
)
assert_metadata_unchanged(resumed_replacement_metadata, "replacement resume changed metadata")
terminal_callbacks.TermClose()

notifications = {}
set_metadata(missing_id, false)
local manual_missing_metadata = session.get_metadata(nvim_session)
local manual_fresh_terminal = pi.start()
assert(manual_fresh_terminal == terminal, "PiStart did not start a fresh terminal for a missing session")
assert(#opened == opened_before + 3, "PiStart missing-session fallback opened the wrong number of terminals")
local manual_fresh_launch_id = assert_fresh_command(opened[#opened].command, "PiStart missing-session fallback")
assert(has_notification("started a new Pi session"), "PiStart did not report its missing-session recovery")
assert_metadata_unchanged(manual_missing_metadata, "PiStart fallback replaced metadata before Pi binding")
local manual_replacement_id = "manual-replacement-session-3.3"
assert(type(pi.bind_session({
	sessionId = manual_replacement_id,
	launchId = manual_fresh_launch_id,
	channelId = 22,
	cwd = repo_root,
	editorPid = vim.fn.getpid(),
})) == "table", "PiStart fresh fallback did not bind Pi's actual session ID")
assert(
	session.get_metadata(nvim_session).pi_session_id == manual_replacement_id,
	"PiStart fallback did not persist its bound ID"
)
terminal_callbacks.TermClose()
opened_before = #opened

notifications = {}
local malformed_id = "malformed-session-3.3"
write_session(malformed_id, repo_root, { type = "not-a-session", id = malformed_id, cwd = repo_root })
set_metadata(malformed_id, true)
local malformed_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == false, "malformed Pi session requested restoration")
assert(#opened == opened_before, "malformed Pi session opened Pi")
assert(has_notification("saved session file is invalid"), "malformed Pi session was not reported")
assert_metadata_unchanged(malformed_metadata, "malformed-session rejection changed metadata")

notifications = {}
local relative_cwd_id = "relative-cwd-session-3.3"
write_session(relative_cwd_id, ".")
set_metadata(relative_cwd_id, true)
local relative_cwd_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == false, "relative-cwd Pi session requested restoration")
assert(#opened == opened_before, "relative-cwd Pi session opened Pi")
assert(has_notification("saved session file is invalid"), "relative-cwd Pi session was not reported")
assert_metadata_unchanged(relative_cwd_metadata, "relative-cwd rejection changed metadata")

notifications = {}
local ambiguous_id = "ambiguous-session-3.3"
write_session(ambiguous_id, repo_root, nil, session_dir)
write_session(ambiguous_id, repo_root, nil, settings_dir)
set_metadata(ambiguous_id, true)
local ambiguous_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == false, "ambiguous Pi session requested restoration")
assert(#opened == opened_before, "ambiguous Pi session opened Pi")
assert(has_notification("multiple files have the saved session ID"), "ambiguous Pi session was not reported")
assert_metadata_unchanged(ambiguous_metadata, "ambiguous-session rejection changed metadata")

notifications = {}
local wrong_id = "wrong-worktree-session-3.3"
write_session(wrong_id, sibling_worktree, nil, sibling_session_dir)
set_metadata(wrong_id, true)
local wrong_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == false, "wrong-worktree Pi session requested restoration")
assert(#opened == opened_before, "wrong-worktree Pi session opened Pi")
assert(has_notification("belongs to another worktree"), "wrong-worktree Pi session was not reported")
assert_metadata_unchanged(wrong_metadata, "wrong-worktree rejection changed metadata")

notifications = {}
set_metadata(exact_id, true)
local ambient_cwd_metadata = session.get_metadata(nvim_session)
vim.cmd("cd " .. vim.fn.fnameescape(sibling_worktree))
assert(pi.restore() == false, "restore ignored the active Neovim worktree")
vim.cmd("cd " .. vim.fn.fnameescape(repo_root))
assert(#opened == opened_before, "restore opened Pi from the wrong Neovim worktree")
assert(has_notification("belongs to another worktree"), "active Neovim worktree mismatch was not reported")
assert_metadata_unchanged(ambient_cwd_metadata, "active-worktree rejection changed metadata")

notifications = {}
local launch_failure_id = "launch-failure-session-3.3"
local launch_failure_path = write_session(launch_failure_id, repo_root)
set_metadata(launch_failure_id, true)
local launch_failure_metadata = session.get_metadata(nvim_session)
local launch_failure_file = vim.fn.readfile(launch_failure_path, "b")
fail_open = true
assert(pi.restore() == false, "failed terminal launch reported success")
fail_open = false
assert(#opened == opened_before, "failed terminal launch recorded an open terminal")
assert(has_notification("Pi terminal could not be opened"), "failed terminal launch was not reported")
assert_metadata_unchanged(launch_failure_metadata, "terminal-launch failure changed metadata")
assert(
	vim.deep_equal(vim.fn.readfile(launch_failure_path, "b"), launch_failure_file),
	"terminal-launch failure changed the Pi session file"
)

notifications = {}
local limited_agent_dir = test_root .. "/limited-pi-agent"
local limited_sessions_root = limited_agent_dir .. "/sessions"
for index = 1, 1025 do
	vim.fn.mkdir(limited_sessions_root .. "/directory-" .. index, "p")
end
vim.env.PI_CODING_AGENT_DIR = limited_agent_dir
vim.env.PI_CODING_AGENT_SESSION_DIR = nil
local limited_metadata = session.get_metadata(nvim_session)
assert(pi.restore() == false, "limited Pi session search requested restoration")
assert(#opened == opened_before, "limited Pi session search opened Pi")
assert(has_notification("session search limit was reached"), "limited Pi session search was not reported")
assert_metadata_unchanged(limited_metadata, "limited-session rejection changed metadata")

rawset(vim, "notify", original_notify)
vim.env.PI_CODING_AGENT_DIR = previous_agent_dir
vim.env.PI_CODING_AGENT_SESSION_DIR = previous_session_dir
vim.env.HERDR_ENV = previous_herdr_env
vim.env.HERDR_PANE_ID = previous_herdr_pane_id
vim.env.PI_NVIM_HERDR_PANE_ID = previous_pi_herdr_pane_id
vim.fn.delete(test_root, "rf")
