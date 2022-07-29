return function()
  vim.defer_fn(function()
    vim.schedule(function()
      require("nvim-autopairs").setup()
    end)
    require("nvim-treesitter.configs").setup({
      autopairs = { enable = true },
      autotag = { enable = true },
      ensure_installed = "all",
      highlight = { enable = true },
      indent = { enable = true }
    })
  end, 150)
end
