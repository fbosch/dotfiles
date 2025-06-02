local function term_keymaps(mappings)
	local res = {}
	for _, map in ipairs(mappings) do
		local keys, cmd, desc = map[1], map[2], map[3]
		-- normal mode mapping
		table.insert(res, {
			keys,
			"<cmd>" .. cmd .. "<cr>",
			desc = desc,
			mode = "n",
			silent = true,
		})
		-- terminal mode mapping (with escape from terminal mode)
		table.insert(res, {
			keys,
			"<C-\\><C-n><cmd>" .. cmd .. "<cr>",
			desc = desc,
			mode = "t",
			silent = true,
		})
	end
	return res
end

return {
	{
		"numtostr/FTerm.nvim",
		cmd = { "FTermOpen", "FTermClose", "FTermExit", "FTermToggle", "FtermMProcs", "FTermLazyGit" },
		keys = term_keymaps({
			{ "<A-t>", "FTermToggle", "toggle floating terminal" },
			{ "<A-m>", "FTermMProcs", "toggle floating terminal with mprocs" },
			{ "<A-g>", "FTermLazyGit", "toggle floating terminal with gitui" },
			{ "<A-b>", "FTermBtop", "toggle floating terminal with btop" },
		}),
		config = function()
			local usrcmd = vim.api.nvim_create_user_command
			local fterm = require("FTerm")
			local env = {
				["IN_NEOVIM"] = "1",
			}
			local dimensions = {
				height = 0.85,
				width = 0.85,
			}

			fterm.setup({
				border = "rounded",
				env = env,
				dimensions = dimensions,
			})

			usrcmd("FTermOpen", fterm.open, { bang = true })
			usrcmd("FTermClose", fterm.close, { bang = true })
			usrcmd("FTermExit", fterm.exit, { bang = true })
			usrcmd("FTermToggle", fterm.toggle, { bang = true })

			local mprocs_instance = nil
			usrcmd("FTermMProcs", function()
				if not mprocs_instance then
					local args = require("utils.project").resolve_mprocs_args()
					mprocs_instance = fterm:new({
						ft = "fterm_mprocs",
						env = env,
						shell = "dash",
						cmd = string.format("mprocs %s", args),
						dimensions = dimensions,
					})
				end
				mprocs_instance:toggle()
			end, { bang = true })

			local lazygit_instance = nil
			usrcmd("FTermLazyGit", function()
				if not lazygit_instance then
					lazygit_instance = fterm:new({
						ft = "fterm_gitui",
						env = env,
						shell = "dash",
						cmd = "lazygit",
						dimensions = dimensions,
					})
				end
				lazygit_instance:toggle()
			end, { bang = true })

			local btop_instance = nil

			usrcmd("FTermBtop", function()
				if not btop_instance then
					btop_instance = fterm:new({
						ft = "fterm_btop",
						env = env,
						shell = "dash",
						cmd = "btop -p 2 --update 1000",
						dimensions = dimensions,
					})
				end

				btop_instance:toggle()
			end, { bang = true })
		end,
	},
	{
		"akinsho/toggleterm.nvim",
		event = "VeryLazy",
		opts = {
			size = 20,
			open_mapping = [[<a-\>]],
			close_mapping = [[<a-\>]],
			hide_numbers = true,
			shade_filetypes = {},
			shade_terminals = true,
			shading_factor = 1,
			start_in_insert = true,
			persist_size = true,
			direction = "horizontal",
			close_on_exit = true,
			shell = vim.o.shell,
		},
	},
}
