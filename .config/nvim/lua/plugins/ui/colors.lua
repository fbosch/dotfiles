return {
	{
		"uga-rosa/ccc.nvim",
		ft = { "css", "scss", "less", "sass", "html", "typescriptreact", "javascriptreact" },
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
			virtual_symbol = " ",
			virtual_pos = "inline-left",
			highlighter = {
				auto_enable = true,
				lsp = true,
				filetypes = { "css", "typescriptreact", "javascriptreact", "html", "lua", "ron", "xml" },
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
		end,
	},
}
