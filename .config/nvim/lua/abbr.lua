local abbreviations = {
	{ ["cl"] = "console.log()<esc>h" },
	{ ["teh"] = "the" },
	{ ["seperate"] = "separate" },
	{ ["definately"] = "definitely" },
	{ ["cahnge"] = "change" },
}

vim.schedule_wrap(function()
	for _, value in pairs(abbreviations) do
		for k, v in pairs(value) do
			vim.cmd.abbreviate(k, v)
		end
	end
end)
