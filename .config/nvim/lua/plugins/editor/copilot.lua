return {
	{
		"supermaven-inc/supermaven-nvim",
		event = "InsertEnter",
		config = function()
			require("supermaven-nvim").setup({
				keymaps = {
					accept_suggestion = "<Tab>",
					clear_suggestion = "<C-]>",
					accept_word = "<C-j>",
				},
			})
		end,
	},
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		event = "InsertEnter",
		enabled = false,
		opts = {
			filetypes = {
				lua = true,
				javascript = true,
				javascriptreact = true,
				typescript = true,
				typescriptreact = true,
				rust = true,
				fish = true,
				["*"] = false,
			},
			panel = {
				enabled = false,
			},
			suggestion = {
				enabled = true,
				auto_trigger = true,
				debounce = 50,
				keymap = {
					accept = "<Tab>",
					next = "<C-j>",
					prev = "<C-k>",
					dismiss = "<C-\\>",
				},
			},
		},
	},
}
