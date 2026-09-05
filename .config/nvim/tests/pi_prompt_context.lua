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
		local request = requests[#requests]
		assert(request.text == "explain æøå", "Pi Ask changed the user's text")
		local selection_modes = { v = "character", V = "line", [string.char(22)] = "block" }
		assert(
			vim.deep_equal(request.context, {
				path = repo_root .. "/pi-ask-selection-fixture.lua",
				buffer = source,
				changedtick = vim.api.nvim_buf_get_changedtick(source),
				selectionMode = selection_modes[mode],
				selection = vim.o.selection,
				range = {
					anchor = { line = endpoints[1], column = 1, offset = 0 },
					cursor = { line = endpoints[2], column = 2, offset = 0 },
				},
			}),
			"Pi Ask lost its captured selection reference"
		)
		assert(not vim.json.encode(request):find("anden", 1, true), "reference context copied source text")
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
assert(requests[#requests].text == "cursor question")
assert(requests[#requests].context.selectionMode == "cursor")
assert(vim.deep_equal(requests[#requests].context.range, {
	anchor = { line = 2, column = 2, offset = 0 },
	cursor = { line = 2, column = 2, offset = 0 },
}))
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
confirm(string.rep("a", 16 * 1024 + 1))
assert(starts == before_starts and #requests == before_requests, "context bypassed the prompt text limit")
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
vim.api.nvim_buf_set_lines(source, 0, -1, false, vim.fn["repeat"]({ "large range source text" }, 10000))
select("V", 1, 10000)
local original_getregion = vim.fn.getregion
rawset(vim.fn, "getregion", function()
	error("reference capture must not read selected text")
end)
assert(prompt.ask("") == true, "large reference-only selection could not open Pi Ask")
rawset(vim.fn, "getregion", original_getregion)
confirm("question about a large range")
local large = requests[#requests].context
assert(large.range.anchor.line == 1 and large.range.cursor.line == 10000)
assert(#vim.json.encode(large) < 1024, "large selection produced a large prompt context")
assert(not vim.json.encode(large):find("large range source text", 1, true))
accept_last()

vim.cmd("normal! \27")
vim.api.nvim_buf_set_lines(source, 0, -1, false, { "æøå🚀", "\ttext" })
local original_selection = vim.o.selection
local original_virtualedit = vim.o.virtualedit
vim.o.selection = "exclusive"
vim.o.virtualedit = "all"
vim.api.nvim_win_set_cursor(0, { 1, 2 })
vim.cmd("normal! v")
vim.api.nvim_win_set_cursor(0, { 1, 6 })
assert(prompt.ask("") == true)
vim.o.selection = "inclusive"
confirm("multibyte range")
local multibyte = requests[#requests].context
assert(multibyte.selection == "exclusive", "input-time selection option replaced the snapshot")
assert(multibyte.range.anchor.column == 3 and multibyte.range.cursor.column == 7, "UTF-8 byte columns changed")
accept_last()
vim.cmd("normal! \27")
vim.o.selection = original_selection
vim.o.virtualedit = original_virtualedit

local function read_reference(context, extra)
	return bridge.dispatch({
		channelId = binding.channelId,
		operation = "read_buffer",
		payload = vim.tbl_extend("force", {
			buffer = context.buffer,
			expectedPath = context.path,
			expectedChangedtick = context.changedtick,
			startLine = 1,
			endLine = 1,
		}, extra or {}),
	})
end
assert(vim.deep_equal(read_reference(multibyte).lines, { "æøå🚀" }), "guarded read did not return unsaved text")
assert(read_reference(multibyte, { expectedPath = repo_root .. "/different-file.lua" }).error == "contextStale")
assert(read_reference(multibyte, { expectedChangedtick = -1 }).error == "invalidRequest")
assert(read_reference(multibyte, { expectedPath = "relative.lua" }).error == "invalidRequest")
vim.api.nvim_buf_set_lines(source, 0, 1, false, { "new source" })
assert(read_reference(multibyte).error == "contextStale", "guarded read accepted a changed source")
local latest = assert(bridge.capture_prompt_location()).context
vim.api.nvim_buf_set_name(source, repo_root .. "/pi-ask-renamed-fixture.lua")
assert(read_reference(latest).error == "contextStale", "guarded read accepted a renamed buffer")

vim.cmd("normal! \27")
vim.api.nvim_set_current_buf(input_buffer)
vim.cmd("normal! v")
assert(prompt.ask("") == false, "a special-buffer selection silently lost its context")
assert(notifications[#notifications]:find("PI_CONTEXT_UNAVAILABLE", 1, true))
vim.cmd("normal! \27")
local location, failure = bridge.capture_prompt_location()
assert(location == nil and failure == nil, "normal special-buffer Ask cannot remain literal")

local capture = bridge.capture_prompt_location
bridge.capture_prompt_location = function()
	return { buffer = source, reference = "old module result" }
end
local before_reload_starts = starts
assert(prompt.ask("") == false, "mixed bridge versions did not fail closed")
assert(
	notifications[#notifications]:find("PI_RELOAD_REQUIRED", 1, true),
	"mixed bridge versions lacked a reload message"
)
assert(starts == before_reload_starts, "mixed bridge versions started Pi")
bridge.capture_prompt_location = capture

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
