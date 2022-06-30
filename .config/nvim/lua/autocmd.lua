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
  command = "source <afile> | PackerSync",
  group = group
})
cmd({ "BufWritePost" }, {
  pattern = { "*nvim/*.lua" },
  command = "source <afile> | PackerCompile",
  group = group
})
cmd({ "BufNewFile", "BufRead" }, {
  pattern = { "*.es6" },
  command = "setf javascript",
  group = group
})
cmd({ "BufNewFile", "BufRead" }, {
  pattern = { "*.tsx" },
  command = "setf typescriptreact",
  group = group
})
cmd({ "BufNewFile", "BufRead"}, {
  pattern = { "*.md", "*.mdx" },
  command = "setf markdown",
  group = group
})
cmd({ "BufWritePre" }, {
  pattern = { "*" },
  command = "lua vim.lsp.buf.formatting()",
  group = group
})
