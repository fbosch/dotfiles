return {
	"Bryley/neoai.nvim",
	dependencies = {
		"MunifTanjim/nui.nvim",
	},
	cmd = {
		"NeoAI",
		"NeoAIOpen",
		"NeoAIClose",
		"NeoAIToggle",
		"NeoAIContext",
		"NeoAIContextOpen",
		"NeoAIContextClose",
		"NeoAIInject",
		"NeoAIInjectCode",
		"NeoAIInjectContext",
		"NeoAIInjectContextCode",
	},
	keys = {
		{ "<leader>ais", desc = "summarize text" },
		{ "<leader>aig", desc = "generate git message" },
	},
	config = function()
		require("neoai").setup({
			-- Options go here
		})
	end,
}
