return function()
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
        debounce = 20
      }),
      wilder.vim_search_pipeline({ debounce = 20 })
    )
  })
  wilder.set_option("use_python_remote_plugin", 0)
  wilder.set_option("renderer", wilder.popupmenu_renderer(
    wilder.popupmenu_border_theme({
      pumblend = 10,
      border = "rounded",
      background = "dark",
      highlighter = {
        wilder.pcre2_highlighter(),
        wilder.lua_fzy_highlighter()
      },
      highlights = {
          accent = wilder.make_hl("WilderAccent", "Pmenu", {{ foreground = "#ffffff" }, { background = -1 }, { foreground = "#B279A7" }})
      },
      left = {
        ' ',
        wilder.popupmenu_devicons(),
        wilder.popupmenu_buffer_flags({
          flags = ' a + ',
          icons = {['+'] = '', a = '', h = ''},
        }),
      },
      right = {
        ' ',
        wilder.popupmenu_scrollbar(),
      },
    })
  ))
end
