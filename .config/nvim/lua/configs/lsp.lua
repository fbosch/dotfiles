return function()
  local lspconfig = require("lspconfig")
  vim.defer_fn(function()
    require("lsp_signature").setup({
      bind = true,
      hint_prefix = "﬌ ",
      handler_opts = {
        border = "rounded"
      }
    })
    require(".configs.null-ls")()
    require(".configs.prettier")()
    require("fzf_lsp").setup()
    require("nvim-ts-autotag").setup()
    require("nvim-lsp-installer").setup({
      ui = {
        border = "rounded",
        icons = {
          server_installed = "✓",
          server_pending = "➜",
          server_uninstalled = "✗"
        }
      }
    })
  end, 200)

  local capabilities = vim.lsp.protocol.make_client_capabilities()

  local on_attach = function(client, bufnr)
    local bufopts = { noremap=true, silent=true, buffer=bufnr }
    vim.keymap.set('n', 'gD', vim.lsp.buf.declaration, bufopts)
    vim.keymap.set('n', 'gd', vim.lsp.buf.definition, bufopts)
    vim.keymap.set('n', 'K', vim.lsp.buf.hover, bufopts)
    vim.keymap.set('n', 'gi', vim.lsp.buf.implementation, bufopts)
    vim.keymap.set('n', 'gr', vim.lsp.buf.references, bufopts)
    vim.keymap.set('n', '<C-k>', vim.lsp.buf.signature_help, bufopts)
    vim.keymap.set('n', '<leader>wa', vim.lsp.buf.add_workspace_folder, bufopts)
    vim.keymap.set('n', '<leader>wr', vim.lsp.buf.remove_workspace_folder, bufopts)
    vim.keymap.set('n', '<leader>wl', function()
      print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
    end, bufopts)
    vim.keymap.set('n', '<leader>D', vim.lsp.buf.type_definition, bufopts)
    vim.keymap.set('n', '<leader>rn', vim.lsp.buf.rename, bufopts)
    vim.keymap.set('n', '<leader>ca', vim.lsp.buf.code_action, bufopts)
    vim.keymap.set('n', '<leader>f', vim.lsp.buf.formatting, bufopts)

    -- floating diagnostics
    local signs = { Error = " ", Warn = " ", Hint = " ", Info = " " }
    for type, icon in pairs(signs) do
      local hl = "DiagnosticSign" .. type
      vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
    end

    vim.diagnostic.config({
      virtual_text = false,
      signs = true,
      underline = true,
      update_in_insert = true,
      severity_sort = false,
    })

    vim.api.nvim_create_autocmd("CursorHold", {
      buffer = bufnr,
      callback = function()
         local opts = {
          focusable = false,
          close_events = { "BufLeave", "CursorMoved", "InsertEnter", "FocusLost" },
          border = 'rounded',
          source = 'always',
          prefix = '  ',
          scope = 'cursor',
        }
        vim.diagnostic.open_float(nil, opts)
      end
    })
  end

  lspconfig.tailwindcss.setup({
    cmd = { "tailwindcss-language-server", "--stdio" },
    capabilities = capabilities,
    on_attach = on_attach,
  })

  lspconfig.tsserver.setup({
    init_options = require("nvim-lsp-ts-utils").init_options,
    capabilities = capabilities,
    on_attach = function(client, bufnr)
      client.resolved_capabilities.document_formatting = false
      client.resolved_capabilities.document_range_formatting = false
      local ts_utils = require("nvim-lsp-ts-utils")

      ts_utils.setup({
        enable_import_on_completion = true,
        auto_inlay_hints = false
      })

      ts_utils.setup_client(client)

      local opts = { silent = true }
      vim.api.nvim_buf_set_keymap(bufnr, "n", "gs", ":TSLspOrganize<CR>", opts)
      vim.api.nvim_buf_set_keymap(bufnr, "n", "gr", ":TSLspRenameFile<CR>", opts)
      vim.api.nvim_buf_set_keymap(bufnr, "n", "gi", ":TSLspImportAll<CR>", opts)
      on_attach(client, bufnr)
    end
  })
end
