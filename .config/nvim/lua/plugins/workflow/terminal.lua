local function term_keymaps(mappings)
	for _, map in ipairs(mappings) do
		local keys, cmd, desc = map[1], map[2], map[3]
		vim.keymap.set("n", keys, "<cmd>" .. cmd .. "<cr>", {
			desc = desc,
			silent = true,
		})
		vim.keymap.set("t", keys, "<C-\\><C-n><cmd>" .. cmd .. "<cr>", {
			desc = desc,
			silent = true,
		})
	end
end

return {
	{
		name = "FTerm.nvim",
		src = "https://github.com/numtostr/FTerm.nvim.git",
		init = function()
			term_keymaps({
				{ "<A-t>", "FTermToggle", "toggle floating terminal" },
				{ "<A-m>", "FTermDekit", "toggle floating terminal with dekit" },
				{ "<A-g>", "FTermLazyGit", "toggle floating terminal with gitui" },
				{ "<A-d>", "FTermDiffnav", "toggle floating terminal with diffnav" },
				{ "<A-b>", "FTermBtop", "toggle floating terminal with btop" },
				{ "<A-c>", "FTermCheckmate", "toggle floating terminal with checkmate in neovim instance" },
				{ "<A-s>", "FTermScooter", "toggle floating terminal with scooter" },
			})
		end,
		commands = {
			"FTermOpen",
			"FTermClose",
			"FTermExit",
			"FTermToggle",
			"FTermDekit",
			"FTermLazyGit",
			"FTermDiffnav",
			"FTermBtop",
			"FTermCheckmate",
			"FTermScooter",
		},
		setup = function()
			local usrcmd = vim.api.nvim_create_user_command
			local fterm = require("FTerm")
			local terminal = require("utils.terminal")
			local env = {
				["IN_NEOVIM"] = "1",
			}
			local dimensions = {
				height = 0.85,
				width = 0.85,
			}

			local default_instance = fterm:new({
				border = "rounded",
				env = env,
				dimensions = dimensions,
				shell = "fish",
				cmd = "fish",
			})

			usrcmd("FTermOpen", function()
				terminal.open_floating_terminal(default_instance)
			end, { bang = true })
			usrcmd("FTermClose", function()
				terminal.close_floating_terminal(default_instance)
			end, { bang = true })
			usrcmd("FTermExit", function()
				terminal.close_floating_terminal(default_instance, true)
			end, { bang = true })
			usrcmd("FTermToggle", function()
				terminal.toggle_floating_terminal(default_instance)
			end, { bang = true })

			local dekit_instance = nil
			local dekit_command = nil
			usrcmd("FTermDekit", function()
				local project = require("utils.project")
				local cwd = project.get_project_root() or vim.fn.getcwd()
				local escaped_cwd = vim.fn.shellescape(cwd)
				local cmd = project.resolve_dekit_command(cwd)

				if project.has_file(cwd, ".envrc") then
					cmd = string.format("direnv exec %s %s", escaped_cwd, cmd)
				end
				cmd = string.format("cd %s && %s", escaped_cwd, cmd)

				if not dekit_instance or dekit_command ~= cmd then
					if dekit_instance then
						terminal.close_floating_terminal(dekit_instance, true)
					end

					dekit_command = cmd
					dekit_instance = fterm:new({
						ft = "fterm_dekit",
						env = env,
						shell = "dash",
						cmd = cmd,
						dimensions = dimensions,
					})
				end
				terminal.toggle_floating_terminal(dekit_instance)
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
				terminal.toggle_floating_terminal(lazygit_instance)
			end, { bang = true })

			local diffnav_instance = nil
			local diffnav_root = nil
			usrcmd("FTermDiffnav", function()
				local bufpath = vim.api.nvim_buf_get_name(0)
				bufpath = (bufpath ~= "" and vim.uv.fs_realpath(bufpath)) or bufpath
				local path = bufpath ~= "" and bufpath or vim.fn.getcwd()
				local root = vim.fs.root(path, { ".git", ".bare" })
				if not root then
					vim.notify("No git repository found", vim.log.levels.WARN)
					return
				end

				if not diffnav_instance or diffnav_root ~= root then
					if diffnav_instance then
						terminal.close_floating_terminal(diffnav_instance, true)
					end

					diffnav_root = root
					diffnav_instance = fterm:new({
						ft = "fterm_diffnav",
						env = env,
						shell = "dash",
						cmd = string.format("cd %s && diffnav --watch", vim.fn.shellescape(root)),
						dimensions = dimensions,
					})
				end

				terminal.toggle_floating_terminal(diffnav_instance)
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

				terminal.toggle_floating_terminal(btop_instance)
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

				terminal.toggle_floating_terminal(scooter_instance)
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

				terminal.toggle_floating_terminal(checkmate_instance)
			end, { bang = true })
		end,
	},
}
