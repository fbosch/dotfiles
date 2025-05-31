if vim.env.PROF then
	local snacks = vim.fn.stdpath("data") .. "/lazy/snacks.nvim"
	vim.opt.rtp:append(snacks)
	require("snacks.profiler").startup({
		startup = {
			event = "VimEnter",
		},
	})
end

vim.loader.enable()

vim.g.mapleader = " "
vim.g.maplocalleader = " "
vim.g.spellfile_URL = "http://ftp.vim.org/vim/runtime/spell"

-- lite colorscheme
vim.g.terminal_color_0 = "#191919"
vim.g.terminal_color_1 = "#DE6E7C"
vim.g.terminal_color_2 = "#819B69"
vim.g.terminal_color_3 = "#B77E64"
vim.g.terminal_color_4 = "#6099C0"
vim.g.terminal_color_5 = "#B279A7"
vim.g.terminal_color_6 = "#66A5AD"
vim.g.terminal_color_7 = "#BBBBBB"
vim.g.terminal_color_8 = "#3D3839"
vim.g.terminal_color_9 = "#E8838F"
vim.g.terminal_color_10 = "#8BAE68"
vim.g.terminal_color_11 = "#D68C67"
vim.g.terminal_color_12 = "#61ABDA"
vim.g.terminal_color_13 = "#CF86C1"
vim.g.terminal_color_14 = "#65B8C1"
vim.g.terminal_color_15 = "#8E8E8E"
vim.api.nvim_set_hl(0, "Normal", { fg = "#BBBBBB", bg = "#191919" })

require("config")
