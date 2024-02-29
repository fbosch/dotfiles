return {
	"zbirenbaum/copilot.lua",
	cmd = "Copilot",
	event = "InsertEnter",
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
}
