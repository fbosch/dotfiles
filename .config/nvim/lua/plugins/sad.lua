return {
	"ray-x/sad.nvim",
	dependencies = { "ray-x/guihua.lua", run = "cd lua/fzy && make" },
	cmd = { "Sad" },
	config = function()
		require("sad").setup()
	end,
}
