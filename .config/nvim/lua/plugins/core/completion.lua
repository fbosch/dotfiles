local function completion_enabled()
	local ok, node = pcall(vim.treesitter.get_node)
	if ok and node ~= nil then
		local node_type = node:type()
		if node_type == "comment" or node_type == "line_comment" or node_type == "block_comment" then
			return false
		end
	end

	return not vim.tbl_contains(
		{ "Comment" },
		vim.fn.synIDattr(vim.fn.synID(vim.fn.line("."), vim.fn.col("."), 1), "name")
	)
end

return {
	{
		"saghen/blink.cmp",
		version = "1.*",
		dependencies = {
			"L3MON4D3/LuaSnip",
		},
		event = "InsertEnter",
		opts = {
			enabled = completion_enabled,
			keymap = {
				preset = "default",
				["<C-d>"] = { "scroll_documentation_up", "fallback" },
				["<C-f>"] = { "scroll_documentation_down", "fallback" },
				["<C-j>"] = { "select_next", "fallback" },
				["<C-k>"] = { "select_prev", "fallback" },
				["<C-y>"] = { "select_and_accept", "fallback" },
			},
			appearance = {
				nerd_font_variant = "mono",
			},
			completion = {
				accept = {
					auto_brackets = { enabled = true },
				},
				list = {
					selection = {
						preselect = true,
						auto_insert = false,
					},
				},
				menu = {
					border = "rounded",
					draw = {
						columns = {
							{ "label", "label_description", gap = 1 },
							{ "kind_icon", "kind" },
						},
					},
				},
				documentation = {
					auto_show = false,
					window = { border = "rounded" },
				},
			},
			snippets = {
				preset = "luasnip",
			},
			sources = {
				default = { "lsp", "snippets", "path", "buffer" },
				per_filetype = {
					tex = { "omni" },
					plaintex = { "omni" },
				},
				providers = {
					lsp = { max_items = 10 },
					snippets = { max_items = 5 },
					path = { max_items = 10 },
					buffer = { max_items = 5, min_keyword_length = 3 },
				},
			},
			fuzzy = {
				implementation = "prefer_rust",
			},
		},
		opts_extend = { "sources.default" },
	},
}
