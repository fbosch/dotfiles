local M = {}
local bridge = require("plugins.ai.pi.bridge")

local max_prompt_bytes = 16 * 1024

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
	for _, codepoint in ipairs({
		0x0085,
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
	}) do
		remaining = remaining:gsub(vim.pesc(vim.fn.nr2char(codepoint)), "")
	end
	return remaining == ""
end

function M.validate(text)
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

function M.open(owner, prefill)
	if owner.prompt_available() == false then
		return false
	end
	local source_window = vim.api.nvim_get_current_win()
	if type(bridge.capture_prompt_location) ~= "function" or type(bridge.validate_prompt_location) ~= "function" then
		owner.prompt_failed("PI_RELOAD_REQUIRED")
		return false
	end
	local location, context_failure = bridge.capture_prompt_location()
	if context_failure ~= nil then
		owner.prompt_failed(context_failure)
		return false
	end
	if location ~= nil and type(location.context) ~= "table" then
		owner.prompt_failed("PI_RELOAD_REQUIRED")
		return false
	end
	if location ~= nil and not valid_utf8(location.context.path) then
		owner.prompt_failed("PI_INVALID_UTF8")
		return false
	end
	local options = { prompt = "Ask Pi: ", default = prefill or "" }
	local snacks_ok, snacks = pcall(require, "snacks")
	if snacks_ok and snacks.config.get("input", {}).enabled then
		options.win = { relative = "cursor", row = -3, col = 0 }
	end
	vim.ui.input(options, function(text)
		if text == nil then
			return
		end
		local failure = M.validate(text)
		if failure ~= nil then
			owner.prompt_failed(failure)
			return
		end
		owner.submit_prompt(text, location, source_window)
	end)
	return true
end

return M
