return {
	"gbrlsnchs/winpick.nvim",
	cmd = { "PickWindow" },
	enable = false,
	keys = {
		{
			mode = "n",
			"<leader>pw",
			"<cmd>PickWindow<cr>",
			desc = "pick window",
		},
	},
	config = function()
		local winpick = require("winpick")
		winpick.setup({
			border = "rounded",
			chars = { "W", "Q", "E", "A", "S", "D", "R", "F", "T", "G" },
		})
		vim.api.nvim_create_user_command("PickWindow", function()
			local winid = winpick.select()

			if winid then
				vim.api.nvim_set_current_win(winid)
			end
		end, {})
	end,
}
