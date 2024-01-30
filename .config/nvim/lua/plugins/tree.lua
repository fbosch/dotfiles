return {
	"kyazdani42/nvim-tree.lua",
	dependencies = { "nvim-tree/nvim-web-devicons", "mcchrish/zenbones.nvim" },
	config = function()
		require("nvim-web-devicons").setup()
		require("nvim-tree").setup({
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
			view = {
				number = false,
				relativenumber = false,
				adaptive_size = true,
				-- hide_root_folder = true,
			},
			modified = {
				enable = true,
				show_on_open_dirs = false,
			},
		})
	end,
}
