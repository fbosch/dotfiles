return function()
  vim.defer_fn(function()
    vim.schedule(function()
      require("nvim-autopairs").setup()
    end)
    require("nvim-treesitter.configs").setup({
      additional_vim_regex_highlighting = false,
      autopairs = { enable = true },
      autotag = { enable = true },
      ensure_installed = {
        "javascript",
        "jsdoc",
        "typescript",
        "html",
        "css",
        "markdown",
        "yaml",
        "regex",
      },
      highlight = { enable = true },
      indent = { enable = true }
    })
  end, 150)
end
