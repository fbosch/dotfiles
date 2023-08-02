return {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  dependencies = { "windwp/nvim-autopairs" },
  event = { "BufReadPost", "BufNewFile" },
  config = function()
    require("nvim-autopairs").setup({ check_ts = true })
    require("nvim-treesitter.configs").setup({
      auto_install = true,
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
        "vim",
      },
      highlight = { enable = true },
      indent = { enable = true },
    })
  end,
}
