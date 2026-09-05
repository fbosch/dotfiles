local repo_root = assert(vim.env.REPO_ROOT)
local bridge = require("plugins.ai.pi.bridge")
local original_input = vim.ui.input
local original_notify = vim.notify
local original_rpcnotify = vim.rpcnotify
local original_integration = package.loaded["plugins.ai.pi"]
local original_prompt = package.loaded["plugins.ai.pi.prompt"]
local original_snacks = package.loaded["snacks"]
local original_cwd = vim.fn.getcwd()
local snacks_enabled = true
local input_options, confirm
local requests, notifications = {}, {}
local starts, focuses = 0, 0
local bound = true
local binding = {
	version = 1,
	channelId = 12,
	cwd = repo_root,
	editorPid = vim.fn.getpid(),
	launchId = "abcdef0123456789abcdef0123456789",
	ownerId = "herdr-w1-p1",
	sessionId = "pi-context-session",
}
package.loaded["plugins.ai.pi.prompt"] = nil
package.loaded["plugins.ai.pi"] = {
	ensure_started = function()
		starts = starts + 1
		return {}
	end,
	prompt_launch = function()
		return binding
	end,
	prompt_identity = function()
		return bound and binding or nil
	end,
	focus_bound = function()
		focuses = focuses + 1
		return true
	end,
}
package.loaded["snacks"] = {
	config = {
		get = function(name)
			assert(name == "input")
			return { enabled = snacks_enabled }
		end,
	},
}
rawset(vim.ui, "input", function(options, callback)
	input_options, confirm = options, callback
end)
rawset(vim, "notify", function(message)
	table.insert(notifications, message)
end)
rawset(vim, "rpcnotify", function(_, method, request)
	assert(method == "pi:nvim-prompt/v1")
	table.insert(requests, vim.deepcopy(request))
	return true
end)
vim.cmd.cd(repo_root)
local source = vim.api.nvim_create_buf(true, false)
vim.api.nvim_set_current_buf(source)
vim.api.nvim_buf_set_name(source, repo_root .. "/pi-ask-selection-fixture.lua")
vim.api.nvim_buf_set_lines(source, 0, -1, false, { "første", "anden", "tredje", "fjerde" })
local input_buffer = vim.api.nvim_create_buf(false, true)
local prompt = require("plugins.ai.pi.prompt")

local function accept_last()
	local request = assert(requests[#requests])
	assert(prompt.acknowledge({
		version = 1,
		requestId = request.requestId,
		launchId = request.launchId,
		sessionId = request.sessionId,
		ownerId = request.ownerId,
		outcome = "accepted",
		state = "idle",
	}, binding.channelId))
end

local function select(mode, first, last)
	vim.cmd("normal! \27")
	vim.api.nvim_set_current_buf(source)
	vim.api.nvim_win_set_cursor(0, { first, 0 })
	vim.cmd("normal! " .. mode)
	vim.api.nvim_win_set_cursor(0, { last, 1 })
end

for _, mode in ipairs({ "v", "V", string.char(22) }) do
	for _, endpoints in ipairs({ { 2, 4 }, { 4, 2 } }) do
		select(mode, endpoints[1], endpoints[2])
		assert(prompt.ask("explain") == true)
		assert(input_options.default == "explain")
		assert(vim.deep_equal(input_options.win, { relative = "cursor", row = -3, col = 0 }))
		vim.cmd("normal! \27")
		vim.api.nvim_set_current_buf(input_buffer)
		local before = #requests
		confirm("explain æøå")
		assert(#requests == before + 1, "selected Pi Ask did not send once")
		local text = requests[#requests].text
		assert(text:find('"pi-ask-selection-fixture.lua:L2-L4"', 1, true), "Pi Ask lost its captured line range")
		assert(text:find("untrusted metadata", 1, true), "source location was not labeled as data")
		assert(text:find("explain æøå", 1, true), "Pi Ask changed the user's text")
		assert(not text:find("anden", 1, true), "location-only context copied source text")
		assert(focuses == before, "Pi Ask focused before acknowledgement")
		accept_last()
	end
end

vim.api.nvim_set_current_buf(source)
vim.api.nvim_win_set_cursor(0, { 2, 1 })
snacks_enabled = false
assert(prompt.ask("native input") == true)
assert(input_options.win == nil, "native input received Snacks-only options")
confirm("cursor question")
assert(requests[#requests].text:find('"pi-ask-selection-fixture.lua:L2:C2"', 1, true))
accept_last()
snacks_enabled = true

select("V", 2, 4)
local before_starts, before_requests = starts, #requests
assert(prompt.ask("") == true)
confirm(nil)
assert(starts == before_starts and #requests == before_requests, "cancelling contextual Ask started Pi")
assert(prompt.ask("") == true)
confirm(" ")
assert(starts == before_starts and #requests == before_requests, "context made an empty prompt submittable")
assert(prompt.ask("") == true)
confirm(string.rep("a", 16 * 1024))
assert(starts == before_starts and #requests == before_requests, "context bypassed the combined text limit")
assert(notifications[#notifications]:find("PI_PROMPT_TOO_LARGE", 1, true))

assert(prompt.ask("") == true)
vim.api.nvim_buf_set_lines(source, 1, 2, false, { "changed" })
confirm("question about stale selection")
assert(starts == before_starts and #requests == before_requests, "stale source started Pi")
assert(notifications[#notifications]:find("PI_CONTEXT_STALE", 1, true))

select("V", 2, 3)
assert(prompt.ask("") == true)
vim.api.nvim_buf_set_name(source, repo_root .. "/pi-ask-renamed-fixture.lua")
confirm("question about renamed source")
assert(starts == before_starts and #requests == before_requests, "renamed source started Pi")
assert(notifications[#notifications]:find("PI_CONTEXT_STALE", 1, true))

bound = false
prompt.channel_closed(binding.channelId)
select("V", 2, 3)
assert(prompt.ask("") == true)
confirm("source changes during cold startup")
assert(starts == before_starts + 1 and #requests == before_requests)
vim.api.nvim_buf_set_lines(source, 1, 2, false, { "changed again" })
assert(prompt.on_bound(binding))
assert(#requests == before_requests, "stale cold-start context was sent")
assert(notifications[#notifications]:find("PI_CONTEXT_STALE", 1, true))
bound = true

vim.cmd("normal! \27")
vim.api.nvim_buf_set_name(source, "/tmp/pi-ask-outside-fixture.lua")
assert(prompt.ask("") == false, "outside-worktree source opened contextual Ask")
assert(notifications[#notifications]:find("PI_WORKTREE_MISMATCH", 1, true))
vim.api.nvim_buf_set_name(source, repo_root .. "/pi-ask-selection-fixture.lua")
vim.api.nvim_buf_set_lines(source, 0, -1, false, vim.fn["repeat"]({ "line" }, 501))
select("V", 1, 501)
assert(prompt.ask("") == false, "over-limit selection opened Pi Ask")
assert(notifications[#notifications]:find("PI_CONTEXT_TOO_LARGE", 1, true))

vim.cmd("normal! \27")
vim.api.nvim_set_current_buf(input_buffer)
vim.cmd("normal! v")
assert(prompt.ask("") == false, "a special-buffer selection silently lost its context")
assert(notifications[#notifications]:find("PI_CONTEXT_UNAVAILABLE", 1, true))
vim.cmd("normal! \27")
local location, failure = bridge.capture_prompt_location()
assert(location == nil and failure == nil, "normal special-buffer Ask cannot remain literal")

prompt.terminal_closed(binding.launchId)
vim.cmd.cd(original_cwd)
vim.api.nvim_buf_delete(source, { force = true })
vim.api.nvim_buf_delete(input_buffer, { force = true })
rawset(vim.ui, "input", original_input)
rawset(vim, "notify", original_notify)
rawset(vim, "rpcnotify", original_rpcnotify)
package.loaded["plugins.ai.pi"] = original_integration
package.loaded["plugins.ai.pi.prompt"] = original_prompt
package.loaded["snacks"] = original_snacks
