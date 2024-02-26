local abbreviations = {
	{ ["cl"] = "console.log()<esc>h" },
	{ ["teh"] = "the" },
	{ ["seperate"] = "separate" },
	{ ["definately"] = "definitely" },
	{ ["cahnge"] = "change" },
}

vim.api.nvim_create_autocmd({ "VimEnter" }, {
	callback = function()
		for _, value in pairs(abbreviations) do
			for k, v in pairs(value) do
				vim.cmd.abbreviate(k, v)
			end
		end
	end,
	group = vim.api.nvim_create_augroup("abbreviations", {}),
})
