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
	"hyprlang",
}

return {
	name = "ccc.nvim",
	src = "https://github.com/uga-rosa/ccc.nvim.git",
	filetypes = highlighter_filetypes,
	commands = { "CccPick", "CccHighlighterToggle", "CccConvert" },
	keys = {
		{
			"<leader>pc",
			function()
				vim.cmd("CccPick")
			end,
			mode = "n",
			desc = "pick color",
			silent = true,
		},
	},
	setup = function()
		local opts = {
			highlight_mode = "virtual",
			virtual_symbol = " ",
			virtual_pos = "inline-left",
			highlighter = {
				auto_enable = true,
				lsp = true,
				filetypes = highlighter_filetypes,
				update_insert = false,
			},
		}
		local ccc = require("ccc")
		local rgba_hex = require("config.ccc_rgba")
		opts.outputs = {
			ccc.output.hex,
			ccc.output.hex_short,
			ccc.output.css_rgb,
			ccc.output.css_hsl,
			rgba_hex.output,
		}
		opts.pickers = {
			rgba_hex.picker,
			ccc.picker.hex,
			ccc.picker.css_rgb,
			ccc.picker.css_hsl,
			ccc.picker.css_hwb,
			ccc.picker.css_lab,
			ccc.picker.css_lch,
			ccc.picker.css_oklab,
			ccc.picker.css_oklch,
		}
		opts.recognize = {
			input = true,
			output = true,
			pattern = {
				[rgba_hex.picker] = { ccc.input.rgb, rgba_hex.output },
			},
		}
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
}
