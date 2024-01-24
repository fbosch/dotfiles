return {
	"romgrk/barbar.nvim",
	dependencies = { "kyazdani42/nvim-web-devicons" },
	priority = 100,
	event = "ColorScheme",
	config = function()
		vim.defer_fn(function()
			require("bufferline").setup({
				animation = false,
				auto_hide = true,
				maximum_padding = 6,
				icons = {
					pinned = {
						button = "",
					},
					diagnostics = {
						[vim.diagnostic.severity.ERROR] = { enabled = true, icon = "" },
						[vim.diagnostic.severity.WARN] = { enabled = true, icon = "" },
						[vim.diagnostic.severity.INFO] = { enabled = true, icon = "󰋼" },
						[vim.diagnostic.severity.HINT] = { enabled = true, icon = "󰌵" },
					},
				},
			})
		end, 10)
	end,
}
