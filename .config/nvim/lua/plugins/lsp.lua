return {
  "neovim/nvim-lspconfig",
  event = { "BufReadPre", "BufNewFile" },
  dependencies = {
    "williamboman/mason.nvim",
    "lukas-reineke/lsp-format.nvim",
    "jose-elias-alvarez/nvim-lsp-ts-utils",
    "junegunn/fzf",
    "folke/lsp-colors.nvim",
    "gfanto/fzf-lsp.nvim",
    "MunifTanjim/prettier.nvim",
    "jose-elias-alvarez/null-ls.nvim",
    "folke/neodev.nvim",
  },
  config = function()
    local neodev = require("neodev")
    local lspconfig = require("lspconfig")
    local group = vim.api.nvim_create_augroup("lsp", {})
    local capabilities = require("cmp_nvim_lsp").default_capabilities()
    local null_ls = require("null-ls")
    capabilities.textDocument.foldingRange = {
      dynamicRegistration = false,
      lineFoldingOnly = true,
    }
    local language_servers = require("lspconfig").util.available_servers() -- or list servers manually like {'gopls', 'clangd'}
    for _, ls in ipairs(language_servers) do
      require("lspconfig")[ls].setup({
        capabilities = capabilities,
        -- you can add other fields for setting up lsp server in this table
      })
    end
    local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

    require("fzf_lsp").setup()
    require("mason").setup({
      ui = {
        border = "rounded",
        icons = {
          package_installed = "",
          package_pending = "",
          package_uninstalled = "",
        },
      },
    })

    vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
      border = "rounded",
    })

    local on_attach = function(client, bufnr)
      if client.supports_method("textDocument/formatting") then
        vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
        vim.api.nvim_create_autocmd("BufWritePre", {
          group = augroup,
          buffer = bufnr,
          callback = function()
            vim.lsp.buf.format({ bufnr = bufnr })
          end,
        })
      end
      local bufopts = { noremap = true, silent = true, buffer = bufnr }
      vim.keymap.set("n", "gD", vim.lsp.buf.declaration, bufopts)
      vim.keymap.set("n", "gd", vim.lsp.buf.definition, bufopts)
      vim.keymap.set("n", "gi", vim.lsp.buf.implementation, bufopts)
      vim.keymap.set("n", "gr", vim.lsp.buf.references, bufopts)
      vim.keymap.set("n", "<C-k>", vim.lsp.buf.signature_help, bufopts)
      vim.keymap.set("n", "<leader>k", require("pretty_hover").hover, bufopts)
      vim.keymap.set("n", "<leader>wa", vim.lsp.buf.add_workspace_folder, bufopts)
      vim.keymap.set("n", "<leader>wr", vim.lsp.buf.remove_workspace_folder, bufopts)
      vim.keymap.set("n", "<leader>wl", function()
        print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
      end, bufopts)
      vim.keymap.set("n", "<leader>D", vim.lsp.buf.type_definition, bufopts)
      vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, bufopts)
      vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, bufopts)
      -- vim.keymap.set("n", "<leader>f", vim.lsp.buf.formatting, bufopts)

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
        group = group,
        callback = function()
          local opts = {
            focusable = false,
            close_events = { "BufLeave", "CursorMoved", "InsertEnter", "FocusLost" },
            border = "rounded",
            source = "always",
            prefix = "  ",
            scope = "cursor",
          }
          vim.diagnostic.open_float(nil, opts)
        end,
      })
    end

    lspconfig.tailwindcss.setup({
      cmd = { "tailwindcss-language-server", "--stdio" },
      capabilities = capabilities,
      on_attach = on_attach,
    })

    neodev.setup({
      on_attach = on_attach,
      capabilities = capabilities,
      library = {
        plugins = {
          { "nvim-dap-ui", types = true },
        },
      },
    })

    local b = null_ls.builtins

    local sources = {
      b.formatting.prettierd.with({
        filetypes = {
          "html",
          "yaml",
          "markdown",
          "json",
          "javascript",
          "javascriptreact",
          "typescript",
          "typescriptreact",
        },
      }),
      -- diagnostics
      b.diagnostics.markdownlint,
      b.diagnostics.stylelint,
      -- formatting
      b.formatting.stylua,
      b.formatting.jq,
    }

    null_ls.setup({
      on_attach = on_attach,
      sources = sources,
    })

    lspconfig.html.setup({
      on_attach = on_attach,
      capabilities = capabilities,
    })

    lspconfig.tsserver.setup({
      init_options = require("nvim-lsp-ts-utils").init_options,
      capabilities = capabilities,
      on_attach = function(client, bufnr)
        -- client.server_capabilities.documentFormattingProvider = false
        -- client.resolved_capabilities.document_formatting = false
        -- client.server_capabilities.documentRangeFormattingProvider = false
        -- client.resolved_capabilities.document_range_formatting = false
        local ts_utils = require("nvim-lsp-ts-utils")

        ts_utils.setup({
          enable_import_on_completion = true,
          auto_inlay_hints = false,
        })

        ts_utils.setup_client(client)

        local opts = { silent = true }
        vim.api.nvim_buf_set_keymap(bufnr, "n", "gs", ":TSLspOrganize<CR>", opts)
        vim.api.nvim_buf_set_keymap(bufnr, "n", "gr", ":TSLspRenameFile<CR>", opts)
        vim.api.nvim_buf_set_keymap(bufnr, "n", "gi", ":TSLspImportAll<CR>", opts)
        on_attach(client, bufnr)
      end,
    })

    lspconfig.lua_ls.setup({
      settings = {
        Lua = {
          completion = {
            callSnippet = "Replace",
          },
        },
      },
    })
  end,
}
