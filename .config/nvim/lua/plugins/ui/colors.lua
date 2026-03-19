local highlighter_filetypes = {
	"css",
	"scss",
	"less",
	"sass",
	"html",
	"typescriptreact",
	"javascriptreact",
	"markdown",
	"lua",
	"ron",
	"xml",
}

return {
	{

		-- dir = "~/Projects/ccc.nvim",
		-- "fbosch/ccc.nvim",
		"uga-rosa/ccc.nvim",
		ft = highlighter_filetypes,
		cmd = { "CccPick", "CccHighlighterToggle", "CccConvert" },
		keys = {
			{
				mode = "n",
				"<leader>pc",
				"<cmd>CccPick<cr>",
				desc = "pick color",
				silent = true,
			},
		},
		opts = {
			highlight_mode = "virtual",
			virtual_symbol = " ",
			virtual_pos = "inline-left",
			highlighter = {
				auto_enable = true,
				lsp = true,
				filetypes = highlighter_filetypes,
				update_insert = false,
			},
		},
		config = function(_, opts)
			local ccc = require("ccc")
			ccc.setup(opts)

			-- Add error handling wrapper for highlighter to prevent crashes
			local ok, highlighter = pcall(require, "ccc.highlighter")
			if ok and highlighter then
				local original_update = highlighter.update
				highlighter.update = function(...)
					local success, err = pcall(original_update, ...)
					if not success then
						-- Silently ignore column out of range errors
						if not string.match(err or "", "Invalid 'col': out of range") then
							vim.notify("ccc.nvim highlighter error: " .. tostring(err), vim.log.levels.WARN)
						end
					end
				end
			end

			if opts.highlighter and opts.highlighter.auto_enable then
				require("ccc.highlighter"):enable(0)
			end
		end,
	},
}
