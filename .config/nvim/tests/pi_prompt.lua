local repo_root = assert(vim.env.REPO_ROOT)
package.path = table.concat({
	repo_root .. "/.config/nvim/lua/?.lua",
	repo_root .. "/.config/nvim/lua/?/init.lua",
	package.path,
}, ";")

local launch_id = "0123456789abcdef0123456789abcdef"
local binding = {
	version = 1,
	channelId = 12,
	cwd = repo_root,
	editorPid = vim.fn.getpid(),
	launchId = launch_id,
	ownerId = "herdr-w1-p1",
	sessionId = "pi-session-one",
}
local ensure_calls = {}
local focus_calls = {}
package.loaded["plugins.ai.pi"] = {
	ensure_started = function(options)
		table.insert(ensure_calls, options)
		return { buf = 1 }
	end,
	focus_bound = function(expected)
		table.insert(focus_calls, vim.deepcopy(expected))
		return true
	end,
	prompt_identity = function()
		return nil
	end,
	prompt_launch = function()
		return {
			cwd = repo_root,
			editorPid = vim.fn.getpid(),
			launchId = launch_id,
			ownerId = binding.ownerId,
		}
	end,
}

local original_input = vim.ui.input
local original_notify = vim.notify
local original_rpcnotify = vim.rpcnotify
local original_defer_fn = vim.defer_fn
local input_values = {}
local notifications = {}
local requests = {}
local timers = {}
rawset(vim.ui, "input", function(_, callback)
	callback(table.remove(input_values, 1))
end)
rawset(vim, "notify", function(message, level)
	table.insert(notifications, { message = message, level = level })
end)
rawset(vim, "rpcnotify", function(channel, method, request)
	table.insert(requests, { channel = channel, method = method, request = vim.deepcopy(request) })
	return true
end)
rawset(vim, "defer_fn", function(callback)
	local timer = {
		closed = false,
		close = function(self)
			self.closed = true
		end,
		is_closing = function(self)
			return self.closed
		end,
		stop = function() end,
		fire = callback,
	}
	table.insert(timers, timer)
	return timer
end)

local prompt = require("plugins.ai.pi.prompt")

table.insert(input_values, nil)
assert(prompt.ask("") == true, "Pi Ask did not open its input")
assert(#ensure_calls == 0, "cancelled Pi Ask started Pi")
assert(#requests == 0, "cancelled Pi Ask sent a request")
assert(#focus_calls == 0, "cancelled Pi Ask focused Pi")

table.insert(input_values, " \n\t")
prompt.ask("")
assert(#ensure_calls == 0, "empty Pi Ask started Pi")
assert(notifications[#notifications].message:find("PI_PROMPT_EMPTY", 1, true), "empty Pi Ask lacked a stable error")

table.insert(input_values, vim.fn.nr2char(0x00A0) .. vim.fn.nr2char(0x2003))
prompt.ask("")
assert(#ensure_calls == 0, "Unicode whitespace-only Pi Ask started Pi")
assert(notifications[#notifications].message:find("PI_PROMPT_EMPTY", 1, true), "Unicode whitespace was not empty")

table.insert(input_values, string.char(0xFF))
prompt.ask("")
assert(#ensure_calls == 0, "invalid UTF-8 started Pi")
assert(notifications[#notifications].message:find("PI_INVALID_UTF8", 1, true), "invalid UTF-8 lacked a stable error")

table.insert(input_values, string.rep("a", 16 * 1024 + 1))
prompt.ask("")
assert(#ensure_calls == 0, "oversized Pi Ask started Pi")
assert(
	notifications[#notifications].message:find("PI_PROMPT_TOO_LARGE", 1, true),
	"oversized Pi Ask lacked a stable error"
)

table.insert(input_values, "/review æøå 🚀")
prompt.ask("")
assert(#ensure_calls == 1, "valid Pi Ask did not ensure one terminal")
assert(ensure_calls[1].focus == false, "Pi Ask did not request preserve-focus startup")
assert(ensure_calls[1].focus_window == vim.api.nvim_get_current_win(), "Pi Ask lost its source window")
assert(#requests == 0, "Pi Ask sent before the terminal binding")
assert(prompt.on_bound(binding) == true, "Pi Ask rejected a valid terminal binding")
package.loaded["plugins.ai.pi"].prompt_identity = function()
	return binding
end
assert(#requests == 1, "bound Pi Ask did not send exactly one request")
local first = requests[1]
assert(first.channel == binding.channelId, "Pi Ask used the wrong RPC channel")
assert(first.method == "pi:nvim-prompt/v1", "Pi Ask used the wrong notification")
assert(first.request.requestId == "nvim:" .. launch_id .. ":1", "Pi Ask used the wrong request ID")
assert(first.request.sequence == 1, "Pi Ask used the wrong request sequence")
assert(first.request.text == "/review æøå 🚀", "Pi Ask changed literal input")
assert(first.request.context == vim.NIL, "literal Pi Ask invented context")
assert(#focus_calls == 0, "Pi Ask focused before acknowledgement")

local accepted = {
	version = 1,
	requestId = first.request.requestId,
	launchId = launch_id,
	sessionId = binding.sessionId,
	ownerId = binding.ownerId,
	outcome = "accepted",
	state = "idle",
}
assert(prompt.acknowledge(accepted, 13) == false, "Pi Ask accepted an acknowledgement from another channel")
assert(#focus_calls == 0, "mismatched acknowledgement focused Pi")
assert(prompt.acknowledge(accepted, 12) == true, "Pi Ask rejected its acknowledgement")
assert(#focus_calls == 1, "accepted Pi Ask did not focus Pi")
assert(focus_calls[1].launchId == launch_id, "Pi Ask focused another launch")

table.insert(input_values, "stale timer guard")
prompt.ask("")
assert(#requests == 2, "warm Pi Ask did not send immediately")
assert(requests[2].request.sequence == 2, "warm Pi Ask did not advance its sequence")
timers[1].fire()
local pending_duplicate = vim.tbl_extend("force", accepted, {
	code = "PI_REQUEST_PENDING",
	outcome = "duplicate",
	requestId = requests[2].request.requestId,
})
assert(prompt.acknowledge(pending_duplicate, 12) == true, "in-flight duplicate terminated Pi Ask")
assert(#focus_calls == 1, "in-flight duplicate focused Pi")
local second_accepted = vim.tbl_extend("force", accepted, { requestId = requests[2].request.requestId })
assert(prompt.acknowledge(second_accepted, 12) == true, "stale timer cleared a newer Pi Ask")
assert(#focus_calls == 2, "accepted warm Pi Ask did not focus Pi")

table.insert(input_values, "uncertain delivery")
prompt.ask("")
assert(#requests == 3, "timeout Pi Ask did not send")
local timeout_timer = timers[#timers]
timeout_timer.fire()
assert(notifications[#notifications].message:find("PI_ACK_TIMEOUT", 1, true), "Pi Ask timeout was not visible")
local late = vim.tbl_extend("force", accepted, { requestId = requests[3].request.requestId })
assert(prompt.acknowledge(late, 12) == false, "late Pi Ask acknowledgement changed state")
assert(#focus_calls == 2, "late Pi Ask acknowledgement focused Pi")

table.insert(input_values, "busy request")
prompt.ask("")
assert(#requests == 4, "busy acknowledgement fixture did not send")
local rejected = vim.tbl_extend("force", accepted, {
	code = "PI_BUSY",
	outcome = "rejected",
	requestId = requests[4].request.requestId,
	state = "streaming",
})
assert(prompt.acknowledge(rejected, 12) == true, "Pi Ask rejected a valid failure acknowledgement")
assert(notifications[#notifications].message:find("PI_BUSY", 1, true), "Pi Ask rejection was not visible")
assert(#focus_calls == 2, "rejected Pi Ask focused Pi")

table.insert(input_values, "replace session while pending")
prompt.ask("")
assert(#requests == 5, "session replacement fixture did not send")
local replacement = vim.tbl_extend("force", binding, { sessionId = "pi-session-two" })
assert(prompt.on_bound(replacement) == true, "Pi Ask rejected replacement session identity")
assert(
	notifications[#notifications].message:find("PI_SESSION_MISMATCH", 1, true),
	"session replacement did not cancel Pi Ask"
)
assert(
	prompt.acknowledge(vim.tbl_extend("force", accepted, { requestId = requests[5].request.requestId }), 12) == false
)
assert(prompt.on_bound(binding) == true, "Pi Ask did not restore the original test binding")

table.insert(input_values, "close while pending")
prompt.ask("")
assert(#requests == 6, "terminal-close Pi Ask did not send")
prompt.terminal_closed(launch_id)
assert(notifications[#notifications].message:find("PI_DISCONNECTED", 1, true), "terminal close was not visible")
assert(
	prompt.acknowledge(vim.tbl_extend("force", accepted, { requestId = requests[6].request.requestId }), 12) == false
)

package.loaded["plugins.ai.pi"].prompt_identity = function()
	return nil
end
table.insert(input_values, "replace before cold binding")
prompt.ask("")
assert(#requests == 6, "cold pending Pi Ask sent before binding")
prompt.session_replaced(launch_id)
assert(
	notifications[#notifications].message:find("PI_SESSION_MISMATCH", 1, true),
	"cold session replacement kept Pi Ask pending"
)
table.insert(input_values, "waiting for cold binding")
prompt.ask("")
assert(#requests == 6, "second cold pending Pi Ask sent before binding")
prompt.channel_closed(99)
assert(notifications[#notifications].message:find("PI_DISCONNECTED", 1, true), "cold channel close kept Pi Ask pending")

rawset(vim.ui, "input", original_input)
rawset(vim, "notify", original_notify)
rawset(vim, "rpcnotify", original_rpcnotify)
rawset(vim, "defer_fn", original_defer_fn)
