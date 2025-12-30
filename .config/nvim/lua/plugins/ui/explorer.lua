return {
	"nvim-tree/nvim-tree.lua",
	dependencies = {
		"stevearc/dressing.nvim",
	},
	cmd = { "NvimTreeToggle", "NvimTreeFindFile" },
	keys = {
		{
			mode = { "n" },
			"<leader>e",
			"<cmd>NvimTreeToggle<cr>",
			desc = "toggle file explorer",
		},
		{
			mode = { "n" },
			"<leader>ff",
			"<cmd>NvimTreeFindFile<cr>",
			desc = "find file in file explorer",
		},
	},
	config = function()
		local terminal = require("utils.terminal")
		local is_terminal_emulator = terminal.is_terminal_emulator()

		local function on_attach(bufnr)
			local api = require("nvim-tree.api")
			-- default mappings
			api.config.mappings.default_on_attach(bufnr)

			local map = function(mode, lhs, rhs, desc)
				return require("utils").set_keymap(mode, lhs, rhs, {
					desc = "nvim-tree: " .. desc,
					noremap = true,
					buffer = bufnr,
					silent = true,
					nowait = true,
				})
			end

			-- allow for moving out of the tree with HJKL
			map("n", "H", ":wincmd h<CR>", "Move to left window")
			map("n", "J", ":wincmd j<CR>", "Move to bottom window")
			map("n", "K", ":wincmd k<CR>", "Move to top window")
			map("n", "L", ":wincmd l<CR>", "Move to right window")

			-- Override default edit behavior for image files
			map("n", "<CR>", function()
				local node = api.tree.get_node_under_cursor()
				if node and node.type == "file" then
					local filename = node.absolute_path
					local extension = filename:match("^.+%.(.+)$")
					if extension then
						extension = extension:lower()
						local image_extensions = { "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico" }
						for _, ext in ipairs(image_extensions) do
							if extension == ext then
								vim.fn.jobstart({ "xdg-open", filename }, { detach = true })
								return
							end
						end
					end
				end
				-- Default behavior for non-image files
				api.node.open.edit()
			end, "Open file (images with xdg-open)")
		end
		require("nvim-tree").setup({
			on_attach = on_attach,
			sync_root_with_cwd = true,
			respect_buf_cwd = true,
			update_focused_file = {
				enable = true,
				update_root = false,
			},
			disable_netrw = true,
			hijack_netrw = true,
			-- Performance optimization: reduce lag on first open
			hijack_cursor = false,
			reload_on_bufenter = false,
			renderer = {
				root_folder_label = false,
				symlink_destination = false,
				icons = {
					show = {
						file = is_terminal_emulator,
						-- folder = is_terminal_emulator,
						-- folder_arrow = is_terminal_emulator,
						-- git = is_terminal_emulator,
					},
					glyphs = is_terminal_emulator and {} or {
						default = " ",
						symlink = "->",
						bookmark = "BM",
						folder = {
							arrow_closed = ">",
							arrow_open = "v",
							default = "+",
							open = "-",
							empty = ".",
							empty_open = "-",
							symlink = "->",
							symlink_open = "->",
						},
						git = {
							unstaged = "!",
							staged = "+",
							unmerged = "=",
							renamed = "R",
							untracked = "?",
							deleted = "D",
							ignored = "I",
						},
					},
				},
			},
			filters = {
				custom = { "node_modules" },
				dotfiles = false,
				git_ignored = false,
			},
			view = {
				side = "right",
				number = true,
				relativenumber = true,
				-- Use fixed width instead of adaptive_size to prevent resize jank
				width = 35,
			},
			modified = {
				enable = true,
				show_on_open_dirs = false,
			},
			-- Disable filesystem watchers for better performance
			filesystem_watchers = {
				enable = true,
				debounce_delay = 50,
				ignore_dirs = {
					"node_modules",
					".git",
				},
			},
		})
	end,
}
