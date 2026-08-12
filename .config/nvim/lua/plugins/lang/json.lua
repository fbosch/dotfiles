require("config.pack.registry").register({
	name = "nvim-jqx",
	src = "https://github.com/gennaro-tedesco/nvim-jqx.git",
	filetypes = { "json", "yaml" },
	events = { "BufWritePost" },
})

return {}
