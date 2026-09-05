local M = {}

local notification = "pi:nvim-prompt/v1"
local max_prompt_bytes = 16 * 1024
local request_timeout_ms = 10 * 1000

local active_binding
local sequence_launch_id
local next_sequence = 1
local pending

local failure_messages = {
	PI_ACK_TIMEOUT = "Pi may have received the prompt; inspect Pi before submitting it again.",
	PI_BUSY = "Wait for the current Pi response or question to finish.",
	PI_DISCONNECTED = "The bound Pi terminal disconnected.",
	PI_INVALID_REQUEST = "The prompt request was invalid.",
	PI_INVALID_UTF8 = "The prompt is not valid UTF-8.",
	PI_LAUNCH_MISMATCH = "Restart the Pi terminal before using Pi Ask.",
	PI_NO_UI = "Pi Ask requires the interactive Pi terminal.",
	PI_PROMPT_EMPTY = "Enter a prompt before submitting.",
	PI_PROMPT_TOO_LARGE = "The prompt exceeds the 16 KiB limit.",
	PI_REQUEST_ID_REUSED = "The prompt request identity was already used.",
	PI_REQUEST_OUT_OF_ORDER = "The prompt request arrived out of order.",
	PI_REQUEST_PENDING = "The prompt request is already being delivered.",
	PI_SESSION_MISMATCH = "The Pi terminal session changed; submit from the current session.",
	PI_SESSION_NOT_READY = "Pi did not finish binding its terminal session.",
	PI_STALE_REQUEST = "The prompt request is stale.",
	PI_UNSUPPORTED = "This Pi version could not accept the prompt.",
	PI_WORKTREE_MISMATCH = "The Pi terminal belongs to another worktree.",
}

local function notify_failure(code)
	vim.notify(
		string.format("Pi Ask failed (%s): %s", code, failure_messages[code] or "The request was rejected."),
		vim.log.levels.WARN
	)
end

local function stop_timer(timer)
	if timer == nil then
		return
	end
	pcall(function()
		if not timer:is_closing() then
			timer:stop()
			timer:close()
		end
	end)
end

local function clear_pending()
	if pending == nil then
		return nil
	end
	local current = pending
	pending = nil
	stop_timer(current.timer)
	return current
end

local function continuation(byte)
	return byte ~= nil and byte >= 0x80 and byte <= 0xBF
end

local function valid_utf8(text)
	local index = 1
	while index <= #text do
		local first = text:byte(index)
		if first <= 0x7F then
			index = index + 1
		elseif first >= 0xC2 and first <= 0xDF then
			if not continuation(text:byte(index + 1)) then
				return false
			end
			index = index + 2
		elseif first == 0xE0 then
			local second = text:byte(index + 1)
			if second == nil or second < 0xA0 or second > 0xBF or not continuation(text:byte(index + 2)) then
				return false
			end
			index = index + 3
		elseif (first >= 0xE1 and first <= 0xEC) or (first >= 0xEE and first <= 0xEF) then
			if not continuation(text:byte(index + 1)) or not continuation(text:byte(index + 2)) then
				return false
			end
			index = index + 3
		elseif first == 0xED then
			local second = text:byte(index + 1)
			if second == nil or second < 0x80 or second > 0x9F or not continuation(text:byte(index + 2)) then
				return false
			end
			index = index + 3
		elseif first == 0xF0 then
			local second = text:byte(index + 1)
			if
				second == nil
				or second < 0x90
				or second > 0xBF
				or not continuation(text:byte(index + 2))
				or not continuation(text:byte(index + 3))
			then
				return false
			end
			index = index + 4
		elseif first >= 0xF1 and first <= 0xF3 then
			if
				not continuation(text:byte(index + 1))
				or not continuation(text:byte(index + 2))
				or not continuation(text:byte(index + 3))
			then
				return false
			end
			index = index + 4
		elseif first == 0xF4 then
			local second = text:byte(index + 1)
			if
				second == nil
				or second < 0x80
				or second > 0x8F
				or not continuation(text:byte(index + 2))
				or not continuation(text:byte(index + 3))
			then
				return false
			end
			index = index + 4
		else
			return false
		end
	end
	return true
end

local function whitespace_only(text)
	local remaining = text:gsub("%s", "")
	local unicode_whitespace = {
		0x00A0,
		0x1680,
		0x2000,
		0x2001,
		0x2002,
		0x2003,
		0x2004,
		0x2005,
		0x2006,
		0x2007,
		0x2008,
		0x2009,
		0x200A,
		0x2028,
		0x2029,
		0x202F,
		0x205F,
		0x3000,
		0xFEFF,
	}
	for _, codepoint in ipairs(unicode_whitespace) do
		remaining = remaining:gsub(vim.pesc(vim.fn.nr2char(codepoint)), "")
	end
	return remaining == ""
end

local function validate_prompt(text)
	if type(text) ~= "string" or text:find("\0", 1, true) ~= nil then
		return "PI_INVALID_REQUEST"
	end
	if not valid_utf8(text) then
		return "PI_INVALID_UTF8"
	end
	if #text > max_prompt_bytes then
		return "PI_PROMPT_TOO_LARGE"
	end
	if whitespace_only(text) then
		return "PI_PROMPT_EMPTY"
	end
	return nil
end

local function valid_identity(identity)
	return type(identity) == "table"
		and identity.version == 1
		and type(identity.channelId) == "number"
		and identity.channelId >= 1
		and identity.channelId % 1 == 0
		and type(identity.cwd) == "string"
		and type(identity.editorPid) == "number"
		and identity.editorPid >= 1
		and identity.editorPid % 1 == 0
		and type(identity.launchId) == "string"
		and #identity.launchId == 32
		and identity.launchId:match("^[a-f0-9]+$") ~= nil
		and type(identity.ownerId) == "string"
		and identity.ownerId ~= ""
		and #identity.ownerId <= 128
		and type(identity.sessionId) == "string"
		and identity.sessionId ~= ""
		and #identity.sessionId <= 128
end

local function send_pending()
	if pending == nil or pending.sent or active_binding == nil then
		return
	end
	if pending.launchId ~= active_binding.launchId then
		clear_pending()
		notify_failure("PI_LAUNCH_MISMATCH")
		return
	end
	if pending.expectedSessionId ~= nil and pending.expectedSessionId ~= active_binding.sessionId then
		clear_pending()
		notify_failure("PI_SESSION_MISMATCH")
		return
	end

	local sequence = next_sequence
	next_sequence = next_sequence + 1
	pending.sequence = sequence
	pending.requestId = string.format("nvim:%s:%d", active_binding.launchId, sequence)
	pending.sessionId = active_binding.sessionId
	pending.sent = true
	local request = {
		version = 1,
		requestId = pending.requestId,
		sequence = sequence,
		operation = "submit",
		launchId = active_binding.launchId,
		sessionId = active_binding.sessionId,
		ownerId = active_binding.ownerId,
		cwd = active_binding.cwd,
		editorPid = active_binding.editorPid,
		text = pending.text,
		context = vim.NIL,
	}
	local ok = pcall(vim.rpcnotify, active_binding.channelId, notification, request)
	if not ok then
		clear_pending()
		notify_failure("PI_DISCONNECTED")
	end
end

function M.on_bound(identity)
	if not valid_identity(identity) then
		return false
	end
	if pending ~= nil and pending.sent and pending.sessionId ~= identity.sessionId then
		clear_pending()
		notify_failure("PI_SESSION_MISMATCH")
	end
	if sequence_launch_id ~= identity.launchId then
		next_sequence = 1
		sequence_launch_id = identity.launchId
	end
	active_binding = vim.deepcopy(identity)
	send_pending()
	return true
end

function M.acknowledge(payload, channel)
	if
		pending == nil
		or not pending.sent
		or active_binding == nil
		or type(payload) ~= "table"
		or vim.tbl_count(payload) ~= (payload.code == nil and 7 or 8)
		or payload.version ~= 1
		or payload.requestId ~= pending.requestId
		or payload.launchId ~= active_binding.launchId
		or payload.sessionId ~= active_binding.sessionId
		or payload.ownerId ~= active_binding.ownerId
		or channel ~= active_binding.channelId
		or (payload.outcome ~= "accepted" and payload.outcome ~= "duplicate" and payload.outcome ~= "rejected")
		or (payload.state ~= "starting" and payload.state ~= "idle" and payload.state ~= "streaming" and payload.state ~= "blocked" and payload.state ~= "closed")
		or (payload.code ~= nil and (type(payload.code) ~= "string" or failure_messages[payload.code] == nil))
		or (payload.outcome == "accepted" and payload.code ~= nil)
		or (payload.outcome == "rejected" and payload.code == nil)
	then
		return false
	end
	for key in pairs(payload) do
		if
			key ~= "version"
			and key ~= "requestId"
			and key ~= "launchId"
			and key ~= "sessionId"
			and key ~= "ownerId"
			and key ~= "outcome"
			and key ~= "state"
			and key ~= "code"
		then
			return false
		end
	end

	if payload.outcome == "duplicate" and payload.code == "PI_REQUEST_PENDING" then
		return true
	end
	local completed = clear_pending()
	if payload.outcome == "accepted" or (payload.outcome == "duplicate" and payload.code == nil) then
		local integration = require("plugins.ai.pi")
		return integration.focus_bound({
			channelId = channel,
			launchId = payload.launchId,
			sessionId = payload.sessionId,
		})
	end
	notify_failure(payload.code or "PI_UNSUPPORTED")
	return completed ~= nil
end

function M.ask(prefill)
	if pending ~= nil then
		notify_failure("PI_BUSY")
		return false
	end
	local source_window = vim.api.nvim_get_current_win()
	vim.ui.input({ prompt = "Ask Pi: ", default = prefill or "" }, function(text)
		if text == nil then
			return
		end
		local failure = validate_prompt(text)
		if failure ~= nil then
			notify_failure(failure)
			return
		end
		if pending ~= nil then
			notify_failure("PI_BUSY")
			return
		end

		local integration = require("plugins.ai.pi")
		local terminal = integration.ensure_started({ focus = false, focus_window = source_window })
		if terminal == nil then
			return
		end
		local launch = integration.prompt_launch()
		if launch == nil then
			notify_failure("PI_SESSION_NOT_READY")
			return
		end
		pending = {
			expectedSessionId = launch.sessionId,
			launchId = launch.launchId,
			text = text,
			sent = false,
		}
		local current = pending
		current.timer = vim.defer_fn(function()
			if pending == current then
				clear_pending()
				notify_failure(current.sent and "PI_ACK_TIMEOUT" or "PI_SESSION_NOT_READY")
			end
		end, request_timeout_ms)

		local identity = integration.prompt_identity()
		if identity ~= nil then
			M.on_bound(identity)
		end
	end)
	return true
end

function M.terminal_closed(launch_id)
	if pending ~= nil and pending.launchId == launch_id then
		clear_pending()
		notify_failure("PI_DISCONNECTED")
	end
	if active_binding ~= nil and active_binding.launchId == launch_id then
		active_binding = nil
	end
	if sequence_launch_id == launch_id then
		sequence_launch_id = nil
		next_sequence = 1
	end
end

function M.channel_closed(channel)
	if active_binding ~= nil and active_binding.channelId == channel then
		local launch_id = active_binding.launchId
		active_binding = nil
		if pending ~= nil and pending.launchId == launch_id then
			clear_pending()
			notify_failure("PI_DISCONNECTED")
		end
	elseif active_binding == nil and pending ~= nil then
		clear_pending()
		notify_failure("PI_DISCONNECTED")
	end
end

function M.session_replaced(launch_id)
	if pending ~= nil and pending.launchId == launch_id then
		clear_pending()
		notify_failure("PI_SESSION_MISMATCH")
	end
	if active_binding ~= nil and active_binding.launchId == launch_id then
		active_binding = nil
	end
end

function M.binding_unavailable(launch_id)
	if pending ~= nil and pending.launchId == launch_id then
		clear_pending()
		notify_failure("PI_SESSION_NOT_READY")
	end
	if active_binding ~= nil and active_binding.launchId == launch_id then
		active_binding = nil
	end
end

return M
