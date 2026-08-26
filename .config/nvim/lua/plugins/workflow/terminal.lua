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

term_keymaps({
	{ "<A-t>", "FTermToggle", "toggle floating terminal" },
	{ "<A-m>", "FTermMProcs", "toggle floating terminal with mprocs" },
	{ "<A-g>", "FTermLazyGit", "toggle floating terminal with gitui" },
	{ "<A-d>", "FTermDiffnav", "toggle floating terminal with diffnav" },
	{ "<A-b>", "FTermBtop", "toggle floating terminal with btop" },
	{ "<A-c>", "FTermCheckmate", "toggle floating terminal with checkmate in neovim instance" },
	{ "<A-s>", "FTermScooter", "toggle floating terminal with scooter" },
})

require("config.pack.registry").register({
	{
		name = "FTerm.nvim",
		src = "https://github.com/numtostr/FTerm.nvim.git",
		commands = {
			"FTermOpen",
			"FTermClose",
			"FTermExit",
			"FTermToggle",
			"FTermMProcs",
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

			local mprocs_instance = nil
			local mprocs_command = nil
			usrcmd("FTermMProcs", function()
				local project = require("utils.project")
				local args = project.resolve_mprocs_args()
				local cmd = string.format("mprocs %s", args)
				local root = project.get_project_root()
				local cwd = root or vim.fn.getcwd()

				if project.has_file(cwd, ".envrc") then
					cmd = string.format("direnv exec %s %s", vim.fn.shellescape(cwd), cmd)
				end

				if root then
					cmd = string.format("cd %s && %s", vim.fn.shellescape(root), cmd)
				end

				if not mprocs_instance or mprocs_command ~= cmd then
					if mprocs_instance then
						terminal.close_floating_terminal(mprocs_instance, true)
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
				terminal.toggle_floating_terminal(mprocs_instance)
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
})
