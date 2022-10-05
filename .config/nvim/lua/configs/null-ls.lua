return function()
  local null_ls = require("null-ls")

  null_ls.setup({
    on_attach = function(client, bufnr)
       if client.server_capabilities.documentFormattingProvider then
        vim.cmd("nnoremap <silent><buffer> <Leader>f :lua vim.lsp.buf.formatting()<CR>")
        -- format on save
        vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
        vim.api.nvim_create_autocmd("BufWritePre", {
          group = augroup,
          buffer = bufnr,
          callback = function()
            vim.lsp.buf.formatting_sync()
          end
        })
      end

      if client.server_capabilities.documentRangeFormattingProvider then
        vim.cmd("xnoremap <silent><buffer> <Leader>f :lua vim.lsp.buf.range_formatting({})<CR>")
      end
    end,
    sources = {
      null_ls.builtins.diagnostics.eslint, -- eslint or eslint_d
      null_ls.builtins.code_actions.eslint, -- eslint or eslint_d
      null_ls.builtins.formatting.prettier -- prettier, eslint, eslint_d, or prettierd
    }
  })

end
