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

require("config")
