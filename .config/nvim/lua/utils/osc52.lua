-- OSC 52 clipboard support for remote/headless environments
-- Works over SSH with wezterm, kitty, iTerm2, and tmux

local M = {}

-- Check if we're in a remote SSH session
function M.is_ssh()
	return vim.env.SSH_TTY ~= nil or vim.env.SSH_CONNECTION ~= nil
end

-- Check if terminal supports OSC 52
function M.supports_osc52()
	local term = vim.env.TERM or ""
	local term_program = vim.env.TERM_PROGRAM or ""
	
	return term:match("tmux")
		or term:match("screen")
		or term_program:match("WezTerm")
		or term_program:match("iTerm")
		or term:match("kitty")
		or term:match("xterm%-kitty")
end

-- Setup OSC 52 clipboard provider
function M.setup()
	-- Only use OSC 52 if we're in SSH or if terminal supports it
	if not (M.is_ssh() or M.supports_osc52()) then
		return
	end

	vim.g.clipboard = {
		name = "OSC 52",
		copy = {
			["+"] = require("vim.ui.clipboard.osc52").copy("+"),
			["*"] = require("vim.ui.clipboard.osc52").copy("*"),
		},
		paste = {
			["+"] = require("vim.ui.clipboard.osc52").paste("+"),
			["*"] = require("vim.ui.clipboard.osc52").paste("*"),
		},
	}

	-- Notify that OSC 52 is active (can be commented out if too noisy)
	vim.notify("OSC 52 clipboard enabled", vim.log.levels.INFO, { title = "Clipboard" })
end

return M
