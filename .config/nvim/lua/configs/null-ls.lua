return function()
  local null_ls = require("null-ls")

  null_ls.setup({
    on_attach = function(client, bufnr)
       if client.resolved_capabilities.document_formatting then
        vim.cmd("nnoremap <silent><buffer> <Leader>f :lua vim.lsp.buf.formatting()<CR>")
        -- format on save
        vim.cmd("autocmd BufWritePost <buffer> lua vim.lsp.buf.formatting()")
      end

      if client.resolved_capabilities.document_range_formatting then
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
