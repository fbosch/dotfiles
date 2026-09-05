local repo_root = assert(vim.env.REPO_ROOT)
local original_herdr_env = vim.env.HERDR_ENV
local original_herdr_pane_id = vim.env.HERDR_PANE_ID
local original_pi_herdr_pane_id = vim.env.PI_NVIM_HERDR_PANE_ID
vim.env.HERDR_ENV = "1"
vim.env.HERDR_PANE_ID = "wFixture:p1"
vim.env.PI_NVIM_HERDR_PANE_ID = nil
local metadata_root = vim.fn.tempname()
local nvim_session = {
	cwd = repo_root,
	metadata_path = metadata_root .. "/session.json",
	specifier = "fixture",
}
local session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
session.set_current(nvim_session)
session.set_metadata({
	opencode_session_id = "ses_exact",
	opencode_terminal_open = true,
}, nvim_session)
package.loaded["utils.session"] = session
local find_requests = {}
local saved_session_dir = metadata_root .. "/pi-sessions"
package.loaded["plugins.ai.pi.session"] = {
	find_exact = function(session_id, cwd)
		table.insert(find_requests, { session_id = session_id, cwd = cwd })
		if session_id == "pi-session-one" then
			return { directory = saved_session_dir, cwd = cwd }, nil
		end
		return nil, "missing"
	end,
}
local recorded_source_context
package.loaded["plugins.ai.pi.bridge"] = {
	record_source_context = function(context)
		recorded_source_context = vim.deepcopy(context)
		return true
	end,
}

local captured_command
local captured_options
local callbacks = {}
local focuses = 0
local shows = 0
local toggles = 0
local terminal = {
	buf = vim.api.nvim_create_buf(false, true),
	buf_valid = function()
		return true
	end,
	focus = function(self)
		focuses = focuses + 1
		return self
	end,
	on = function(_, event, callback)
		callbacks[event] = callback
	end,
	show = function(self)
		shows = shows + 1
		return self
	end,
	toggle = function(self)
		toggles = toggles + 1
		return self
	end,
	valid = function()
		return true
	end,
}
package.loaded["snacks.terminal"] = {
	open = function(command, options)
		captured_command = command
		captured_options = options
		options.win.on_buf(terminal)
		return terminal
	end,
}

vim.cmd("edit " .. vim.fn.fnameescape(repo_root .. "/.config/nvim/lua/config/usercmd.lua"))
vim.api.nvim_win_set_cursor(0, { 1, 0 })
vim.cmd("normal! v2l")
local pi = dofile(repo_root .. "/.config/nvim/lua/plugins/ai/pi/init.lua")
local command_prefix = "env -u HERDR_PANE_ID PI_NVIM_HERDR_PANE_ID="
	.. vim.fn.shellescape(vim.env.HERDR_PANE_ID)
	.. " PI_NVIM_LAUNCH_ID="
local first = pi.start()
assert(first == terminal, "Pi launcher did not return its terminal")
assert(captured_command ~= nil, "Pi launcher did not open a terminal")
local first_launch_id = assert(captured_command:match("PI_NVIM_LAUNCH_ID='([a-f0-9]+)'"))
assert(#first_launch_id == 32, "Pi launcher did not generate a bounded launch ID")
local expected_prefix = command_prefix
	.. vim.fn.shellescape(first_launch_id)
	.. " PI_NVIM_SOCKET="
	.. vim.fn.shellescape(vim.v.servername)
assert(captured_command == expected_prefix .. " pi", "fresh Pi launcher did not let Pi assign its session ID")
assert(
	recorded_source_context.buffer.name == repo_root .. "/.config/nvim/lua/config/usercmd.lua",
	"Pi launcher did not capture the source context before opening its terminal"
)
assert(recorded_source_context.mode == "v", "Pi launcher did not capture source mode")
assert(recorded_source_context.selection.mode == "v", "Pi launcher did not capture visual mode")
assert(recorded_source_context.selection.lines[1] == "loc", "Pi launcher did not capture the bounded pre-Pi selection")
assert(captured_options.win.position == "left", "Pi terminal was not opened on the left")
assert(captured_options.win.width == 100, "Pi terminal width changed")
assert(captured_options.win.enter == nil, "normal Pi start unexpectedly preserved focus")
assert(vim.b[terminal.buf].is_pi_terminal == true, "Pi terminal buffer was not marked")
assert(type(callbacks.TermClose) == "function", "Pi terminal close was not tracked")
assert(
	vim.iter(vim.api.nvim_buf_get_keymap(terminal.buf, "n")):any(function(mapping)
		return mapping.desc == "Toggle Pi focus"
	end),
	"Pi terminal did not receive its buffer-local focus mapping"
)
local source_window = vim.api.nvim_get_current_win()
vim.cmd("vsplit")
local decoy_window = vim.api.nvim_get_current_win()
vim.api.nvim_win_set_buf(decoy_window, vim.api.nvim_create_buf(false, true))
vim.cmd("vsplit")
local pi_window = vim.api.nvim_get_current_win()
vim.api.nvim_win_set_buf(pi_window, terminal.buf)
local return_mapping = vim.iter(vim.api.nvim_buf_get_keymap(terminal.buf, "n")):find(function(mapping)
	return mapping.desc == "Toggle Pi focus"
end)
return_mapping.callback()
assert(vim.api.nvim_get_current_win() == source_window, "Pi terminal did not return to its source window")
vim.api.nvim_win_close(pi_window, true)
vim.api.nvim_win_close(decoy_window, true)
assert(pi.toggle() == terminal, "Pi toggle did not reuse its live terminal")
assert(toggles == 1, "Pi toggle did not toggle the live terminal exactly once")

local first_context = vim.deepcopy(recorded_source_context)
local second_source = repo_root .. "/.config/nvim/lua/plugins/ai/pi/init.lua"
local foreign_target = vim.tbl_extend("force", vim.deepcopy(nvim_session), { specifier = "other" })
session.set_current(foreign_target)
vim.cmd("edit " .. vim.fn.fnameescape(second_source))
assert(pi.start() == nil, "Pi launcher reused a terminal owned by another Neovim session")
assert(pi.toggle() == nil, "Pi toggle reused a terminal owned by another Neovim session")
assert(toggles == 1, "Foreign-session Pi toggle reached the existing terminal")
assert(
	vim.deep_equal(recorded_source_context, first_context),
	"Foreign-session context reached the existing Pi terminal"
)
session.set_current(nvim_session)

vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
local saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == nil, "unbound Pi terminal invented a session ID")
assert(saved_metadata.pi_terminal_open == false, "unbound Pi terminal was marked restorable")
assert(saved_metadata.opencode_session_id == "ses_exact", "OpenCode session ID changed during Pi save")
assert(saved_metadata.opencode_terminal_open == true, "OpenCode terminal state changed during Pi save")

local first_session_id = "pi-session-one"
assert(pi.bind_session("invalid/session") == false, "invalid Pi session ID was bound")
assert(pi.bind_session({
	sessionId = first_session_id,
	launchId = "abcdef0123456789abcdef0123456789",
	channelId = 12,
	cwd = repo_root,
	editorPid = vim.fn.getpid(),
}) == false, "stale Pi launch ID was bound")
local bound = pi.bind_session({
	sessionId = first_session_id,
	launchId = first_launch_id,
	channelId = 12,
	cwd = repo_root,
	editorPid = vim.fn.getpid(),
})
assert(type(bound) == "table", "Pi-assigned session identity was not bound")
assert(bound.launchId == first_launch_id, "Pi binding changed its launch ID")
assert(bound.channelId == 12, "Pi binding changed its RPC channel")
assert(bound.ownerId == nvim_session.specifier, "Pi binding lost its Neovim session owner")
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == first_session_id, "bound Pi session ID was not persisted immediately")
assert(saved_metadata.pi_terminal_open == true, "bound Pi terminal was not persisted immediately")
assert(saved_metadata.opencode_session_id == "ses_exact", "OpenCode session ID changed after Pi binding")
assert(saved_metadata.opencode_terminal_open == true, "OpenCode terminal state changed after Pi binding")

local restored_session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
local restored_metadata = restored_session.get_metadata(nvim_session)
assert(restored_metadata.pi_session_id == first_session_id, "Pi session ID did not survive metadata load")
assert(restored_metadata.pi_terminal_open == true, "Pi terminal state did not survive metadata load")
assert(restored_metadata.opencode_session_id == "ses_exact", "OpenCode session ID did not survive metadata load")
assert(restored_metadata.opencode_terminal_open == true, "OpenCode terminal state did not survive metadata load")

vim.cmd("edit " .. vim.fn.fnameescape(second_source))
captured_command = nil
local focuses_before_reuse = focuses
assert(pi.ensure_started({ focus = false }) == terminal, "Pi preserve-focus start did not reuse its live terminal")
assert(focuses == focuses_before_reuse, "Pi preserve-focus start focused a live terminal")
assert(pi.start() == terminal, "Pi launcher did not reuse its live terminal")
assert(focuses == focuses_before_reuse + 1, "normal Pi start did not focus its live terminal")
assert(shows >= 1, "normal Pi start did not show its live terminal")
assert(captured_command == nil, "Pi launcher opened a duplicate terminal")
assert(
	recorded_source_context.buffer.name == second_source,
	"Pi launcher did not refresh source context before reusing its terminal"
)

callbacks.TermClose()
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == first_session_id, "closed Pi terminal discarded its session ID")
assert(saved_metadata.pi_terminal_open == false, "closed Pi terminal state was not persisted immediately")
vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.opencode_session_id == "ses_exact", "OpenCode session ID changed after Pi close")

captured_command = nil
local restore_source_window = vim.api.nvim_get_current_win()
pi.ensure_started({ focus = false, focus_window = restore_source_window })
assert(captured_command ~= nil, "Pi launcher did not reopen after terminal close")
local restored_launch_id = assert(captured_command:match("PI_NVIM_LAUNCH_ID='([a-f0-9]+)'"))
assert(restored_launch_id ~= first_launch_id, "Pi launcher reused a closed terminal launch ID")
local restored_prefix = command_prefix
	.. vim.fn.shellescape(restored_launch_id)
	.. " PI_NVIM_SOCKET="
	.. vim.fn.shellescape(vim.v.servername)
assert(
	captured_command
		== restored_prefix
			.. " pi --session-dir "
			.. vim.fn.shellescape(saved_session_dir)
			.. " --session "
			.. vim.fn.shellescape(first_session_id),
	"Pi launcher did not resume the MiniSessions-associated Pi session"
)
assert(captured_options.win.enter == false, "prompt start did not use preserve-focus terminal options")
assert(vim.api.nvim_get_current_win() == restore_source_window, "prompt start changed the source window")
assert(#find_requests == 1, "Pi launcher did not perform one exact saved-session lookup")
assert(find_requests[1].session_id == first_session_id, "Pi launcher looked up the wrong saved session")
assert(find_requests[1].cwd == repo_root, "Pi launcher looked up the saved session in the wrong worktree")
vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == first_session_id, "resumed Pi session ID changed during save")
assert(saved_metadata.pi_terminal_open == true, "resumed Pi terminal state was not saved")

vim.env.HERDR_ENV = original_herdr_env
vim.env.HERDR_PANE_ID = original_herdr_pane_id
vim.env.PI_NVIM_HERDR_PANE_ID = original_pi_herdr_pane_id
vim.fn.delete(metadata_root, "rf")
