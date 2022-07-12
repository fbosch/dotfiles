-- Use a protected call so we don't error out on first use
local status_ok, packer = pcall(require, "packer")
if not status_ok then
  local install_path = vim.fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'
  if vim.fn.empty(vim.fn.glob(install_path)) > 0 then
    packer_bootstrap = vim.fn.system({'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path})
  end
	return
end


if packer_bootstrap and status_ok then
  packer.sync()
end


-- Have packer use a popup window
packer.init({
  display = {
    open_fn = function()
      return require("packer.util").float({ border = "rounded" })
    end,
  },
})

local developmentFiles = { "html", "css", "javascript", "javascriptreact", "typescript", "typescriptreact", "json", "lua" }

-- install packages
return packer.startup({
  function(use)
    use({
      "wbthomason/packer.nvim",
      "lewis6991/impatient.nvim",
      "tweekmonster/startuptime.vim",
      "antoinemadec/FixCursorHold.nvim",
      {
        "mcchrish/zenbones.nvim",
        requires = { "rktjmp/lush.nvim" }
      },
      {
        "rmagatti/auto-session",
        config = function()
          require("auto-session").setup({
            log_level = "error",
          })
        end
      },
        {
        "karb94/neoscroll.nvim",
        event = "CursorHold",
        config = function()
          require("neoscroll").setup({
            hide_cursor = true,
            post_hook = function()
              vim.api.nvim_command("Beacon")
            end
          })
        end
      },
      {
        "github/copilot.vim",
        event = "CursorHoldI",
        ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
      },
      {
        "folke/which-key.nvim",
        config = function()
          require("which-key").setup()
        end,
        event = "VimEnter"
      },
      {
        "f-person/git-blame.nvim",
        event = "CursorHold",
      },
      {
        "tpope/vim-commentary",
        event = "CursorHold",
      },
      {
        "tpope/vim-surround",
        event = "InsertEnter",
      },
      {
        "danilamihailov/beacon.nvim",
        ft = developmentFiles,
        event = "CursorHold",
        config = function()
          vim.g.beacon_size = 30
          vim.highlight.create("Beacon", { guibg = "#bbbbbb", ctermbg = 15 })
        end
      },
      { 
        "tpope/vim-fugitive",
        ft = developmentFiles,
        event = "CursorHold"
      },
      {
        "lukas-reineke/indent-blankline.nvim",
        ft = developmentFiles,
        event = "CursorHold"
      },
      {
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        event = "VimEnter",
        requires = { "windwp/nvim-autopairs" },
        ft = developmentFiles,
        config = require("configs.nvim-treesitter")
      },
      {
        "neovim/nvim-lspconfig",
        ft = developmentFiles,
        after = { "nvim-treesitter" },
        requires = {
          "junegunn/fzf",
          "windwp/nvim-ts-autotag",
          "ray-x/lsp_signature.nvim",
          "folke/lsp-colors.nvim",
          "gfanto/fzf-lsp.nvim",
          "MunifTanjim/prettier.nvim",
          "onsails/lspkind.nvim",
          "L3MON4D3/LuaSnip",
          "saadparwaiz1/cmp_luasnip",
          "hrsh7th/nvim-cmp",
          "hrsh7th/cmp-nvim-lsp",
          "hrsh7th/cmp-buffer",
          "hrsh7th/cmp-path",
          "hrsh7th/cmp-nvim-lua",
          "mtoohey31/cmp-fish",
          "jose-elias-alvarez/null-ls.nvim",
          "jose-elias-alvarez/nvim-lsp-ts-utils",
        },
        config = require("configs.lsp")
      },
      {
        "folke/trouble.nvim",
        requires = { "kyazdani42/nvim-web-devicons" },
        event = "CursorHold",
        config = function()
          require("trouble").setup()
        end
      },
      {
        "rrethy/vim-hexokinase",
        run = "make hexokinase",
        event = "CursorHold",
        config = function()
          vim.g.Hexokinase_highlighters = {"virtual"}
          vim.g.Hexokinase_optInPatterns = {
            "full_hex", "rgb", "rgba", "hsl", "hsla"
          }
        end
      },
      {
        "folke/todo-comments.nvim",
        requires = "nvim-lua/plenary.nvim",
        event = "ColorScheme",
        ft = developmentFiles,
        config = function()
          require("todo-comments").setup()
        end
      },
      {
       "romgrk/barbar.nvim",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = function()
          require("bufferline").setup({
            animation = false,
            icon_pinned = ""
          })
        end
      },
      {
        "nvim-lualine/lualine.nvim",
        requires = { "kyazdani42/nvim-web-devicons", "f-person/git-blame.nvim" },
        after = { "zenbones.nvim", "lush.nvim" },
        config = require("configs.lualine")
      },
      {
        "gelguy/wilder.nvim",
        event = "VimEnter",
        requires = { "kyazdani42/nvim-web-devicons", "romgrk/fzy-lua-native" },
        config = require("configs.wilder")
      },
      {
        "lewis6991/gitsigns.nvim",
        event = "CursorHold",
        ft = developmentFiles,
        config = function()
          require("gitsigns").setup()
        end
      },
      {
        "nvim-telescope/telescope.nvim",
        event = "VimEnter",
        requires = { "nvim-telescope/telescope-file-browser.nvim"  },
        config = require("configs.telescope")
      },
      {
        "ibhagwan/fzf-lua",
        event = "VimEnter",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.fzf")
      },
      {
        "kyazdani42/nvim-tree.lua",
        event = "VimEnter",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.nvim-tree")
      },
    })
  end
})
