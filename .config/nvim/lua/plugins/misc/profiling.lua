require("config.pack.registry").register({
	name = "vim-startuptime",
	src = "https://github.com/dstein64/vim-startuptime.git",
	commands = { "StartupTime" },
	setup = function()
		vim.g.startuptime_tries = 10
	end,
})

return {}
