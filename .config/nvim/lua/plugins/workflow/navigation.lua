local function get_visual_selection()
	local lines = vim.fn.getregion(vim.fn.getpos("v"), vim.fn.getpos("."), { type = vim.fn.mode() })
	if #lines == 0 then
		return nil
	end

	return vim.trim(table.concat(lines, " "))
end

return {
	-- { "tpope/vim-unimpaired", event = "VeryLazy" },
	{
		"jinh0/eyeliner.nvim",
		event = "VeryLazy",
		config = function()
			local colors = require("config.colors")
			require("eyeliner").setup({
				highlight_on_key = true,
				dim = true,
			})
			require("utils").load_highlights({
				EyelinerPrimary = { fg = colors.blue, bold = true, underline = true },
				EyelinerSecondary = { fg = colors.purple, underline = true },
				EyelinerDimmed = { fg = colors.search_backdrop },
			})
		end,
	},
	{
		"nacro90/numb.nvim",
		event = "CmdLineEnter",
		opts = {},
	},
	{
		url = "https://codeberg.org/andyg/leap.nvim",
		event = "VeryLazy",
		keys = {
			{ "s", mode = { "n", "x", "o" }, desc = "Leap forward to" },
			{ "S", mode = { "n", "x", "o" }, desc = "Leap backward to" },
			{ "gs", mode = { "n", "x", "o" }, desc = "Leap from windows" },
		},
		config = function(_, opts)
			vim.schedule(function()
				local leap = require("leap")
				for k, v in pairs(opts) do
					leap.opts[k] = v
				end
				-- leap.add_default_mappings(true)
			end)
		end,
	},
	{
		"dmtrKovalenko/fff.nvim",
		build = function()
			require("fff.download").download_or_build_binary()
		end,
		keys = {
			{
				"<C-p>",
				function()
					require("fff").find_files()
				end,
				desc = "find files",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>lg",
				function()
					require("fff").live_grep()
				end,
				desc = "live grep",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>lg",
				function()
					require("fff").live_grep({ query = get_visual_selection() })
				end,
				desc = "live grep selection",
				mode = { "v" },
				silent = true,
			},
		},
		opts = {
			title = "Find Files",
			max_results = 100,
			max_threads = 4,
			lazy_sync = true,
			prompt = "> ",
			layout = {
				width = 0.9,
				height = 0.8,
				prompt_position = "top",
				preview_position = "right",
				preview_size = 0.5,
				flex = { size = 130, wrap = "top" },
				show_scrollbar = true,
				path_shorten_strategy = "middle_number",
			},
			preview = {
				enabled = true,
				max_size = 10 * 1024 * 1024,
				chunk_size = 8192,
				binary_file_threshold = 1024,
				line_numbers = false,
				wrap_lines = false,
			},
			keymaps = {
				close = { "<C-c>", "<Esc>" },
				select = "<CR>",
				select_split = "<C-s>",
				select_vsplit = "<C-v>",
				select_tab = "<C-t>",
				move_up = { "<Up>", "<C-p>", "<C-k>" },
				move_down = { "<Down>", "<C-n>", "<C-j>" },
				preview_scroll_up = "<C-u>",
				preview_scroll_down = "<C-d>",
				toggle_select = "<Tab>",
				send_to_quickfix = "<C-q>",
			},
			git = {
				status_text_color = false,
			},
			grep = {
				max_file_size = 10 * 1024 * 1024,
				max_matches_per_file = 100,
				smart_case = true,
				time_budget_ms = 150,
				modes = { "plain", "regex", "fuzzy" },
			},
			frecency = {
				enabled = true,
				db_path = vim.fn.stdpath("cache") .. "/fff_nvim_picker",
			},
			history = {
				enabled = true,
				db_path = vim.fn.stdpath("data") .. "/fff_nvim_queries",
				min_combo_count = 3,
				combo_boost_score_multiplier = 100,
			},
			debug = {
				enabled = false,
				show_scores = false,
			},
		},
	},
}
