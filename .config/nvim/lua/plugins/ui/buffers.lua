local function setup_barbar_highlights()
	local colors = require("config.colors")
	local utils = require("utils")
	utils.load_highlights({
		BufferCurrent = { fg = colors.blue },
		BufferAlternate = { fg = colors.lighter_gray, bg = colors.gray },
		BufferInactive = { fg = colors.lighter_gray, bg = colors.gray },
		BufferVisible = { fg = colors.lighter_gray, bg = colors.gray },
		BufferAlternateSign = { fg = colors.light_gray, bg = colors.gray },
		BufferCurrentSign = { fg = colors.blue },
		BufferInactiveSign = { fg = colors.light_gray, bg = colors.gray },
		BufferVisibleSign = { fg = colors.light_gray, bg = colors.gray },
		BufferTabpageFill = { bg = colors.gray },
		BufferAlternateHINT = { fg = colors.purple, bg = colors.gray },
		BufferVisibleHINT = { fg = colors.purple, bg = colors.gray },
		BufferCurrentHINT = { fg = colors.purple },
		BufferInactiveHINT = { fg = colors.purple, bg = colors.gray },
		BufferAlternateERROR = { fg = colors.red, bg = colors.gray },
		BufferVisibleERROR = { fg = colors.red, bg = colors.gray },
		BufferCurrentERROR = { fg = colors.red },
		BufferInactiveERROR = { fg = colors.red, bg = colors.gray },
		BufferAlternateWARN = { fg = colors.orange, bg = colors.gray },
		BufferVisibleWARN = { fg = colors.orange, bg = colors.gray },
		BufferCurrentWARN = { fg = colors.orange },
		BufferInactiveWARN = { fg = colors.orange, bg = colors.gray },
		BufferAlternateINFO = { fg = colors.blue, bg = colors.gray },
		BufferVisibleINFO = { fg = colors.blue, bg = colors.gray },
		BufferCurrentINFO = { fg = colors.blue },
		BufferInactiveINFO = { fg = colors.blue, bg = colors.gray },
	})
end

local function close_all_but_visible_and_terminals()
	local current_win = vim.api.nvim_get_current_win()
	for _, win in ipairs(vim.api.nvim_list_wins()) do
		if win ~= current_win then
			local buf = vim.api.nvim_win_get_buf(win)
			local buftype = vim.api.nvim_get_option_value("buftype", { buf = buf })
			if buftype ~= "terminal" then
				vim.api.nvim_win_close(win, false)
			end
		end
	end
	vim.cmd("BufferCloseAllButVisible")
end

local function buffer_index_keys()
	local t = {}
	for i = 1, 9 do
		t[#t + 1] = {
			"<A-" .. i .. ">",
			function()
				vim.cmd("BufferGoto " .. i)
			end,
			mode = { "n" },
			desc = "go to buffer " .. i,
			silent = true,
		}
	end
	return t
end

vim.g.barbar_auto_setup = false

require("config.pack.registry").register({
	name = "barbar.nvim",
	src = "https://github.com/fbosch/barbar.nvim.git",
	dependencies = { "nvim-web-devicons" },
	commands = {
		"BufferCloseAllButVisible",
		"BufferGoto",
		"BufferMoveNext",
		"BufferMovePrevious",
		"BufferNext",
		"BufferPin",
		"BufferPrevious",
	},
	keys = vim.list_extend(buffer_index_keys(), {
		{
			"<leader>x",
			close_all_but_visible_and_terminals,
			mode = { "n" },
			desc = "close all but currentl active buffer or pinned buffers",
			silent = true,
		},
		{
			"<leader>P",
			function()
				vim.cmd("BufferPin")
			end,
			mode = { "n" },
			desc = "pin current buffer",
			silent = true,
		},
		{
			"<C-h>",
			function()
				vim.cmd("BufferPrevious")
			end,
			mode = { "n" },
			desc = "previous buffer",
			silent = true,
		},
		{
			"<C-l>",
			function()
				vim.cmd("BufferNext")
			end,
			mode = { "n" },
			desc = "next buffer",
			silent = true,
			replace = true,
		},
		{
			"<leader>bh",
			function()
				vim.cmd("BufferMovePrevious")
			end,
			mode = { "n" },
			desc = "move buffer left",
			silent = true,
		},
		{
			"<leader>bl",
			function()
				vim.cmd("BufferMoveNext")
			end,
			mode = { "n" },
			desc = "move buffer right",
			silent = true,
		},
	}),
	setup = function()
		local terminal = require("utils.terminal")
		local is_rich = terminal.is_terminal_emulator()
		local vim_enter_autocmds = {}
		for _, autocmd in ipairs(vim.api.nvim_get_autocmds({ event = "VimEnter" })) do
			if autocmd.id ~= nil then
				vim_enter_autocmds[autocmd.id] = true
			end
		end

		-- Barbar derives and caches devicon backgrounds during setup.
		setup_barbar_highlights()
		require("barbar").setup({
			animation = false,
			auto_hide = true,
			maximum_padding = 5,
			tabpages = true,
			highlight_inactive_file_icons = true,
			highlight_alternate = true,
			sidebar_filetypes = {
				NvimTree = true,
			},
			exclude_name = {
				"startup-log.txt",
			},
			exclude_ft = {
				"opencode",
				"opencode_terminal",
			},
			icons = {
				filetype = {
					custom_colors = false,
					enabled = is_rich,
				},
				pinned = {
					button = is_rich and "󰐃" or "[P]",
					filename = true,
				},
				separator = { left = is_rich and "▎" or "|", right = "" },
				separator_at_end = false,
				diagnostics = {
					[vim.diagnostic.severity.ERROR] = { enabled = true, icon = " ", custom_color = true },
					[vim.diagnostic.severity.WARN] = { enabled = true, icon = " ", custom_color = true },
					[vim.diagnostic.severity.INFO] = { enabled = true, icon = "󰋼 ", custom_color = true },
					[vim.diagnostic.severity.HINT] = { enabled = true, icon = " ", custom_color = true },
					gitsigns = {
						added = { enabled = true, icon = is_rich and "" or "+" },
						changed = { enabled = true, icon = "~" },
						deleted = { enabled = true, icon = is_rich and "" or "-" },
					},
				},
			},
		})

		if vim.v.vim_did_enter == 0 then
			return
		end

		-- Barbar defers its setup to VimEnter, which has already occurred here.
		local bootstrap_autocmds = {}
		for _, autocmd in ipairs(vim.api.nvim_get_autocmds({ event = "VimEnter" })) do
			local info = autocmd.callback and debug.getinfo(autocmd.callback, "S") or nil
			if
				autocmd.id ~= nil
				and vim_enter_autocmds[autocmd.id] == nil
				and info ~= nil
				and info.source:find("/barbar.nvim/lua/barbar.lua", 1, true) ~= nil
			then
				table.insert(bootstrap_autocmds, autocmd)
			end
		end
		assert(#bootstrap_autocmds == 1, "expected one Barbar VimEnter bootstrap callback")

		local bootstrap = bootstrap_autocmds[1]
		vim.api.nvim_del_autocmd(bootstrap.id)
		bootstrap.callback()
		assert(vim.fn.exists(":BufferNext") == 2, "Barbar commands were not initialized")
		assert(vim.o.showtabline == 2, "Barbar tabline was not initialized")
		require("barbar.ui.render").update()
	end,
})

local group = vim.api.nvim_create_augroup("LoadBarbarOnSecondBuffer", { clear = true })
vim.api.nvim_create_autocmd({ "BufAdd", "BufEnter" }, {
	group = group,
	callback = function()
		local buffers = 0
		for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
			if
				vim.bo[buffer].buflisted
				and vim.bo[buffer].buftype == ""
				and vim.api.nvim_buf_get_name(buffer) ~= ""
			then
				buffers = buffers + 1
			end
		end

		if buffers < 2 then
			return
		end

		vim.api.nvim_del_augroup_by_id(group)
		require("config.pack.loader").activate("barbar.nvim", { source = "second-buffer" })
	end,
})
