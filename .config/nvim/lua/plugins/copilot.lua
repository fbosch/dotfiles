return {
	"zbirenbaum/copilot.lua",
	dependencies = {
		"stevearc/conform.nvim",
	},
	cmd = "Copilot",
	event = "InsertEnter",
	config = function()
		local copilot = require("copilot")
		local api = require("copilot.api")
		copilot.setup({
			filetypes = {
				lua = true,
				javascript = true,
				javascriptreact = true,
				typescript = true,
				typescriptreact = true,
				["*"] = false,
			},
			suggestion = {
				auto_trigger = true,
				debounce = 50,
				keymap = {
					accept = "<Tab>",
					next = "<C-j>",
					prev = "<C-k>",
					dismiss = "<C-\\>",
				},
			},
			server_opts_overrides = {
				handlers = {},
			},
		})

		local typescript_filetypes = {
			"javascript",
			"javascriptreact",
			"typescript",
			"typescriptreact",
		}
		api.notify_accepted = function(client, params)
			return api.request(client, "notifyAccepted", params, function()
				if vim.tbl_contains(typescript_filetypes, vim.bo.filetype) then
					vim.cmd("TSLspImportCurrent")
				end
			end)
		end
	end,
}
