return {
	"kyazdani42/nvim-tree.lua",
	dependencies = { "nvim-tree/nvim-web-devicons", "mcchrish/zenbones.nvim" },
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

			local function opts(desc)
				return { desc = "nvim-tree: " .. desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
			end

			-- custom mappings
			vim.keymap.set("n", "H", ":wincmd h<CR>", opts("move to left window"))
			vim.keymap.set("n", "J", ":wincmd j<CR>", opts("move to bottom window"))
			vim.keymap.set("n", "K", ":wincmd k<CR>", opts("move to top window"))
			vim.keymap.set("n", "L", ":wincmd l<CR>", opts("move to right window"))
		end

		require("nvim-web-devicons").setup()
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
				icons = {
					glyphs = {
						modified = "",
					},
				},
			},
			filters = {
				custom = { "node_modules" },
			},
			view = {
				number = false,
				relativenumber = false,
				adaptive_size = true,
			},
			modified = {
				enable = true,
				show_on_open_dirs = false,
			},
		})
	end,
}
