return {
	{
		name = "bufresize.nvim",
		src = "https://github.com/kwkarlwang/bufresize.nvim.git",
		root = false,
		module = "bufresize",
		opts = {},
	},
	{
		name = "smart-splits.nvim",
		src = "https://github.com/mrjones2014/smart-splits.nvim.git",
		dependencies = { "bufresize.nvim" },
		commands = { "SmartResizeLeft", "SmartResizeRight", "SmartResizeUp", "SmartResizeDown" },
		keys = {
			{
				"<C-Left>",
				function()
					vim.cmd("SmartResizeLeft")
				end,
				mode = { "n" },
				desc = "resize left",
			},
			{
				"<C-Right>",
				function()
					vim.cmd("SmartResizeRight")
				end,
				mode = { "n" },
				desc = "resize right",
			},
			{
				"<C-Up>",
				function()
					vim.cmd("SmartResizeUp")
				end,
				mode = { "n" },
				desc = "resize up",
			},
			{
				"<C-Down>",
				function()
					vim.cmd("SmartResizeDown")
				end,
				mode = { "n" },
				desc = "resize down",
			},
		},
		setup = function()
			local bufresize = require("bufresize")
			local smart_splits = require("smart-splits")
			smart_splits.setup({})

			-- Smart Splits suppresses window events while resizing, so refresh Bufresize explicitly.
			for _, resize in ipairs({
				{ command = "SmartResizeLeft", direction = "left" },
				{ command = "SmartResizeRight", direction = "right" },
				{ command = "SmartResizeUp", direction = "up" },
				{ command = "SmartResizeDown", direction = "down" },
			}) do
				vim.api.nvim_del_user_command(resize.command)
				require("utils").set_usrcmd(resize.command, function(args)
					local amount = args.args ~= "" and args.args or nil
					smart_splits["resize_" .. resize.direction](amount)
					bufresize.register()
				end, {
					desc = "smart-splits: resize " .. resize.direction,
					nargs = "*",
				})
			end
		end,
	},
}
