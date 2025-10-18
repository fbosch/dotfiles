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
		cmd = { "FTermOpen", "FTermClose", "FTermExit", "FTermToggle", "FtermMProcs", "FTermLazyGit", "FTermCursorAgent" },
		keys = term_keymaps({
			{ "<A-t>", "FTermToggle", "toggle floating terminal" },
			{ "<A-m>", "FTermMProcs", "toggle floating terminal with mprocs" },
			{ "<A-g>", "FTermLazyGit", "toggle floating terminal with gitui" },
			{ "<A-b>", "FTermBtop", "toggle floating terminal with btop" },
			{ "<A-c>", "FTermCheckmate", "toggle floating terminal with checkmate in neovim instance" },
			{ "<A-a>", "FTermCursorAgent", "toggle floating terminal with cursor-agent" },
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

			local cursor_agent_instance = nil
			local last_notification_time = 0
			local notification_cooldown = 5000
			local terminal_open_time = 0
			local launch_grace_period = 10000
			
			usrcmd("FTermCursorAgent", function()
				if not cursor_agent_instance then
					local Terminal = require("toggleterm.terminal").Terminal
					
					cursor_agent_instance = Terminal:new({
						cmd = "cursor-agent resume",
						direction = "vertical",
						size = function(term)
							if term.direction == "vertical" then
								return vim.o.columns * 0.33
							end
						end,
						hidden = false,
						on_stdout = function(_, _, data)
							if not data then
								return
							end
							
							local current_time = vim.loop.now()
							
							if current_time - terminal_open_time < launch_grace_period then
								return
							end
							
							if current_time - last_notification_time < notification_cooldown then
								return
							end
							
							for _, line in ipairs(data) do
								if line:match("%?%s*%(y/n%)") or 
								   line:match("%?%s*%(Y/n%)") or
								   line:match("Approve%?") or
								   line:match("Accept%?") or
								   line:match("Allow%?") or
								   line:match("Continue%?") then
									last_notification_time = current_time
									vim.schedule(function()
										vim.notify("Cursor Agent: Permission request pending", vim.log.levels.WARN)
									end)
									break
								end
							end
						end,
						on_open = function(term)
							terminal_open_time = vim.loop.now()
							
							vim.cmd("wincmd H")
							local width = math.floor(vim.o.columns * 0.33)
							vim.cmd("vertical resize " .. width)
							
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"n",
								"q",
								"<cmd>close<CR>",
								{ noremap = true, silent = true }
							)
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"t",
								"<A-a>",
								"<cmd>close<CR>",
								{ noremap = true, silent = true }
							)
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"n",
								"<S-h>",
								"<C-w>h",
								{ noremap = true, silent = true }
							)
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"n",
								"<S-l>",
								"<C-w>l",
								{ noremap = true, silent = true }
							)
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"n",
								"<S-j>",
								"<C-w>j",
								{ noremap = true, silent = true }
							)
							vim.api.nvim_buf_set_keymap(
								term.bufnr,
								"n",
								"<S-k>",
								"<C-w>k",
								{ noremap = true, silent = true }
							)
						end,
					})
				end

				cursor_agent_instance:toggle()
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
