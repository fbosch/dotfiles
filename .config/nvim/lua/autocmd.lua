local cmd = vim.api.nvim_create_autocmd
local group = vim.api.nvim_create_augroup("autocommands", {})


cmd({ "BufEnter" }, { command = "syntax sync fromstart", group = group })
cmd({ "BufRead", "BufNewFile" }, {
  pattern = { ".{eslint,babel,stylelint,prettier}rc" },
  command = "set ft=json5",
  group = group
})
cmd({ "BufWritePost" }, {
  pattern = { "plugins.lua" },
  command = "source <afile> | PackerSync"
})
cmd({ "BufWritePost" }, {
  pattern = { "*nvim/*.lua" },
  command = "source <afile> | PackerCompile"
})
