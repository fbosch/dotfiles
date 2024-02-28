return {
	"b0o/incline.nvim",
	event = "VeryLazy",
	enabled = true,
	config = function()
		local colors = require("colors")
		vim.api.nvim_set_hl(0, "InclineNormal", { bg = "NONE" })
		vim.api.nvim_set_hl(0, "InclineNormalNC", { bg = "NONE" })
		require("incline").setup({
			hide = {},
			highlight = {
				groups = {
					InclineNormal = {
						default = true,
						group = "InclineNormal",
					},
					InclineNormalNC = {
						default = true,
						group = "InclineNormalNC",
					},
				},
			},
			window = {
				placement = {
					horizontal = "right",
					vertical = "top",
				},
				margin = {
					horizontal = 2,
					vertical = 2,
				},
			},
			render = function(props)
				local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ":t")
				local ft_icon, ft_color = require("nvim-web-devicons").get_icon_color(filename)
				local is_modified = vim.bo[props.buf].modified

				local function get_git_diff()
					local icons = { removed = "", changed = "", added = "" }
					icons["changed"] = icons.modified
					local signs = vim.b[props.buf].gitsigns_status_dict
					local labels = {}
					if signs == nil then
						return labels
					end
					for name, icon in pairs(icons) do
						if tonumber(signs[name]) and signs[name] > 0 then
							table.insert(labels, { icon .. " " .. signs[name] .. " ", group = "Diff" .. name })
						end
					end
					if #labels > 0 then
						table.insert(labels, { "┊ ", guifg = colors.light_gray })
					end
					return labels
				end
				local function get_diagnostic_label()
					local icons = { error = " ", warn = " ", info = " ", hint = " " }
					local label = {}

					for severity, icon in pairs(icons) do
						local n = #vim.diagnostic.get(
							props.buf,
							{ severity = vim.diagnostic.severity[string.upper(severity)] }
						)
						if n > 0 then
							table.insert(label, { icon .. n .. " ", group = "DiagnosticSign" .. severity, bold = true })
						end
					end
					if #label > 0 then
						table.insert(label, { "┊ ", guifg = colors.light_gray })
					end
					return label
				end

				return {
					{ get_diagnostic_label() },
					{ get_git_diff() },
					{ (ft_icon or "") .. " ", guifg = ft_color, guibg = "none" },
					{ filename .. " ", gui = "bold", guifg = is_modified and colors.orange or colors.lighter_gray },
				}
			end,
		})
	end,
}
