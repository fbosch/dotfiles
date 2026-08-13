local register = require("config.pack.registry").register

register({
	name = "helpview.nvim",
	src = "https://github.com/OXY2DEV/helpview.nvim.git",
	filetypes = { "help" },
	setup = function(event)
		require("helpview.highlights").setup()
		require("helpview").actions.attach(event.buf)
	end,
})
