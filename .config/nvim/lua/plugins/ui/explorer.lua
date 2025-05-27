return {
	"nvim-tree/nvim-tree.lua",
	dependencies = {
		"stevearc/dressing.nvim",
		"mcchrish/zenbones.nvim",
	},
	lazy = false,
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
		end
		require("nvim-tree").setup({
			on_attach = on_attach,
			sync_root_with_cwd = true,
			respect_buf_cwd = true,
			update_focused_file = {
				enable = true,
				-- update_root = true,
			},
			disable_netrw = true,
			hijack_netrw = true,
			renderer = {
				root_folder_label = false,
			},
			filters = {
				custom = { "node_modules" },
				dotfiles = false,
			},
			view = {
				side = "right",
				number = true,
				relativenumber = true,
				adaptive_size = true,
			},
			modified = {
				enable = true,
				show_on_open_dirs = false,
			},
		})
	end,
}
