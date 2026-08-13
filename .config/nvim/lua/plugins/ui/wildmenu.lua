require("config.pack.registry").register({
	{
		name = "fzy-lua-native",
		src = "https://github.com/romgrk/fzy-lua-native.git",
		root = false,
	},
	{
		name = "wilder.nvim",
		src = "https://github.com/gelguy/wilder.nvim.git",
		dependencies = { "nvim-web-devicons", "fzy-lua-native" },
		events = { "CmdlineEnter" },
		setup = function()
			local colors = require("config.colors")
			local wilder = require("wilder")
			wilder.setup({
				modes = { ":", "/", "?" },
				next_key = "<C-j>",
				previous_key = "<C-k>",
				accept_key = "<C-l>",
				reject_key = "<C-c>",
			})
			wilder.set_option("pipeline", {
				wilder.branch(
					wilder.cmdline_pipeline({
						language = "vim",
						fuzzy = 2,
						fuzzy_filter = wilder.lua_fzy_filter(),
						debounce = 20,
					}),
					wilder.vim_search_pipeline({ debounce = 20 })
				),
			})
			wilder.set_option("use_python_remote_plugin", 0)
			wilder.set_option(
				"renderer",
				wilder.popupmenu_renderer(wilder.popupmenu_border_theme({
					pumblend = 10,
					max_height = 15,
					border = "rounded",
					background = "dark",
					highlighter = {
						wilder.pcre2_highlighter(),
						wilder.lua_fzy_highlighter(),
					},
					highlights = {
						accent = wilder.make_hl(
							"WilderAccent",
							"Pmenu",
							{ { foreground = colors.white }, { background = -1 }, { foreground = colors.purple } }
						),
					},
					left = {
						" ",
						wilder.popupmenu_devicons(),
						wilder.popupmenu_buffer_flags({
							flags = " a + ",
						}),
					},
					right = {
						" ",
						wilder.popupmenu_scrollbar(),
					},
				}))
			)
			-- Setup consumes the first CmdlineEnter, so start that command line explicitly.
			vim.fn["wilder#main#start"]()
		end,
	},
})
