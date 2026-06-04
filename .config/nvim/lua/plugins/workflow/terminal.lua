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
		cmd = {
			"FTermOpen",
			"FTermClose",
			"FTermExit",
			"FTermToggle",
			"FtermMProcs",
			"FTermLazyGit",
			"FTermScooter",
		},
		keys = term_keymaps({
			{ "<A-t>", "FTermToggle", "toggle floating terminal" },
			{ "<A-m>", "FTermMProcs", "toggle floating terminal with mprocs" },
			{ "<A-g>", "FTermLazyGit", "toggle floating terminal with gitui" },
			{ "<A-b>", "FTermBtop", "toggle floating terminal with btop" },
			{ "<A-c>", "FTermCheckmate", "toggle floating terminal with checkmate in neovim instance" },
			{ "<A-s>", "FTermScooter", "toggle floating terminal with scooter" },
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
				shell = "fish",
				cmd = "fish",
			})

			usrcmd("FTermOpen", fterm.open, { bang = true })
			usrcmd("FTermClose", fterm.close, { bang = true })
			usrcmd("FTermExit", fterm.exit, { bang = true })
			usrcmd("FTermToggle", fterm.toggle, { bang = true })

			local mprocs_instance = nil
			local mprocs_command = nil
			usrcmd("FTermMProcs", function()
				local project = require("utils.project")
				local args = project.resolve_mprocs_args()
				local cmd = string.format("mprocs %s", args)
				local root = project.get_project_root()

				if root then
					cmd = string.format("cd %s && %s", vim.fn.shellescape(root), cmd)
				end

				if not mprocs_instance or mprocs_command ~= cmd then
					if mprocs_instance then
						mprocs_instance:close(true)
					end

					mprocs_command = cmd
					mprocs_instance = fterm:new({
						ft = "fterm_mprocs",
						env = env,
						shell = "dash",
						cmd = cmd,
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

			local scooter_instance = nil
			usrcmd("FTermScooter", function()
				if not scooter_instance then
					scooter_instance = fterm:new({
						ft = "fterm_scooter",
						env = env,
						shell = "dash",
						cmd = "scooter",
						dimensions = dimensions,
					})
				end

				scooter_instance:toggle()
			end, { bang = true })

			local checkmate_instance = nil
			usrcmd("FTermCheckmate", function()
				local todo_file =
					require("utils.project").find_file_in_project_root({ "todo.md", ".todo.md", "TODO.md" })

				if not todo_file then
					vim.notify("No todo file found in project root", vim.log.levels.WARN)
					return
				end

				if not checkmate_instance then
					checkmate_instance = fterm:new({
						ft = "fterm_checkmate",
						env = env,
						shell = "dash",
						cmd = string.format("nvim %s", todo_file),
						dimensions = {
							height = 0.65,
							width = 0.45,
						},
					})
				end

				checkmate_instance:toggle()
			end, { bang = true })
		end,
	},
	{
		"akinsho/toggleterm.nvim",
		event = "VeryLazy",
		cmd = {
			"DiffnavTerminal",
		},
		keys = {
			{
				"<A-d>",
				"<cmd>DiffnavTerminal<cr>",
				desc = "toggle diffnav right pane",
				mode = "n",
				silent = true,
			},
			{
				"<A-d>",
				"<C-\\><C-n><cmd>DiffnavTerminal<cr>",
				desc = "toggle diffnav right pane",
				mode = "t",
				silent = true,
			},
		},
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
		config = function(_, opts)
			require("toggleterm").setup(opts)

			local diffnav_terminal = nil
			vim.api.nvim_create_user_command("DiffnavTerminal", function()
				if not diffnav_terminal then
					local Terminal = require("toggleterm.terminal").Terminal
					diffnav_terminal = Terminal:new({
						cmd = "diffnav --watch",
						direction = "vertical",
						start_in_insert = true,
						close_on_exit = false,
						size = function(term)
							if term.direction == "vertical" then
								return math.floor(vim.o.columns * 0.45)
							end
						end,
						on_open = function(term)
							vim.cmd("wincmd L")
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"n",
								"q",
								"<cmd>close<CR>",
								{ noremap = true, silent = true }
							)
						end,
					})
				end

				diffnav_terminal:toggle()
			end, { bang = true })
		end,
	},
}
