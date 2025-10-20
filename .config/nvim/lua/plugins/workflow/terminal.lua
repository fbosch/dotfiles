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
			"FTermCursorAgent",
			"SendSelectionToCursorAgent",
			"SendVisibleBuffersToCursorAgent",
		},
		keys = vim.list_extend(term_keymaps({
			{ "<A-t>", "FTermToggle", "toggle floating terminal" },
			{ "<A-m>", "FTermMProcs", "toggle floating terminal with mprocs" },
			{ "<A-g>", "FTermLazyGit", "toggle floating terminal with gitui" },
			{ "<A-b>", "FTermBtop", "toggle floating terminal with btop" },
			{ "<A-c>", "FTermCheckmate", "toggle floating terminal with checkmate in neovim instance" },
			{ "<A-a>", "FTermCursorAgent", "toggle floating terminal with cursor-agent" },
			{ "<A-x>", "SendVisibleBuffersToCursorAgent", "send context (buffers) to cursor agent" },
		}), {
			{
				"<A-x>",
				":<C-u>SendSelectionToCursorAgent<CR>",
				desc = "send context (selection) to cursor agent",
				mode = "v",
				silent = true,
			},
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
						cmd = string.format("nvim %s", todo_file),
						dimensions = {
							height = 0.65,
							width = 0.45,
						},
					})
				end

				checkmate_instance:toggle()
			end, { bang = true })

		local cursor_agent = require("utils.cursor-agent")
		usrcmd("FTermCursorAgent", cursor_agent.toggle, { bang = true })
		cursor_agent.register_commands()
		cursor_agent.setup_keymaps()
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
