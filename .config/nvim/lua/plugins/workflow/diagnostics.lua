local register = require("config.pack.registry").register

register({
	name = "nvim-coverage",
	src = "https://github.com/andythigpen/nvim-coverage.git",
	dependencies = { "plenary.nvim" },
	module = "coverage",
	commands = {
		"Coverage",
		"CoverageLoad",
		"CoverageLoadLcov",
		"CoverageShow",
		"CoverageHide",
		"CoverageToggle",
		"CoverageClear",
		"CoverageSummary",
	},
	keys = {
		{
			"<leader>cc",
			function()
				vim.cmd("Coverage")
			end,
			desc = "Toggle coverage display",
		},
		{
			"<leader>cs",
			function()
				vim.cmd("CoverageSummary")
			end,
			desc = "Coverage summary",
		},
		{
			"<leader>cl",
			function()
				vim.cmd("CoverageLoad")
			end,
			desc = "Load coverage",
		},
	},
	opts = {
		auto_reload = true,
	},
})

register({
	name = "trouble.nvim",
	src = "https://github.com/folke/trouble.nvim.git",
	dependencies = { "nvim-web-devicons" },
	commands = { "Trouble" },
	module = "trouble",
	opts = {},
})

require("utils").set_usrcmd("TodoTrouble", function(args)
	local loader = require("config.pack.loader")
	loader.activate("trouble.nvim", { source = "TodoTrouble" })
	loader.activate("todo-comments.nvim", { source = "TodoTrouble" })

	local command = "Trouble todo" .. (args.args ~= "" and " " .. args.args or "")
	if require("todo-comments.config").loaded then
		vim.cmd(command)
		return
	end

	vim.api.nvim_create_autocmd("VimEnter", {
		once = true,
		callback = function()
			vim.defer_fn(function()
				assert(require("todo-comments.config").loaded, "Todo Comments setup did not complete")
				vim.cmd(command)
			end, 0)
		end,
	})
end, { nargs = "*" })

return {}
