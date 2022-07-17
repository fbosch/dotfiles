local cmd = vim.api.nvim_create_autocmd
local group = vim.api.nvim_create_augroup("autocommands", {})

cmd({ "VimLeavePre" }, {
  callback = function()
    for _, win in ipairs(vim.api.nvim_list_wins()) do
      local config = vim.api.nvim_win_get_config(win)
      if config.relative ~= "" then
        vim.api.nvim_win_close(win, false)
      end
    end
    vim.cmd("NvimTreeClose");
  end,
  group = group,
})
cmd({ "BufEnter" }, { 
  command = "syntax sync fromstart", 
  group = group
})
cmd({ "BufRead", "BufNewFile" }, {
  pattern = { ".{eslint,babel,stylelint,prettier}rc" },
  command = "set ft=json5",
  group = group
})
cmd({ "BufWritePost" }, {
  pattern = { "plugins.lua" },
  command = "source <afile> | PackerSync",
  group = group
})
cmd({ "BufWritePost" }, {
  pattern = { "nvim/*.lua" },
  command = "source <afile> | PackerCompile",
  group = group
})
cmd({ "BufNewFile", "BufRead" }, {
  pattern = { ".{es6,mjs}" },
  command = "setf javascript",
  group = group
})
cmd({ "BufNewFile", "BufRead" }, {
  pattern = { ".tsx" },
  command = "setf typescriptreact",
  group = group
})
cmd({ "BufNewFile", "BufRead"}, {
  pattern = { ".md", ".mdx" },
  command = "setf markdown",
  group = group
})
cmd({ "TextYankPost" }, {
  command = "lua vim.highlight.on_yank({ higroup = 'IncSearch', timeout = 500 })",
  group = group
})
cmd({ "WinEnter" }, {
  command = "Beacon",
  group = group
})
