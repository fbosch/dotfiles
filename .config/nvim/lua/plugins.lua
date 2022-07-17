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
local pluginGroup = vim.api.nvim_create_augroup("plugsin", {})


-- install packages
return packer.startup({
  function(use)
    use({
      "wbthomason/packer.nvim",
      "lewis6991/impatient.nvim",
      "tweekmonster/startuptime.vim",
      "antoinemadec/FixCursorHold.nvim",
      {
        "fedepujol/move.nvim",
        event = "ModeChanged",
     },
      {
        "echasnovski/mini.nvim",
        event = "CursorHold",
        config = function()
          require("mini.trailspace").setup({
            only_in_normal_buffers = true
          })
        end
      },
      {
        "mcchrish/zenbones.nvim",
        requires = { "rktjmp/lush.nvim" },
        event = "VimEnter",
        config = require("configs.colorscheme")
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
        after = { "nvim-treesitter-context" },
        ft = developmentFiles,
        config = function()
          require("neoscroll").setup({
            pre_hook = function()
              vim.opt.lazyredraw = false
              vim.api.nvim_command("TSContextDisable")
            end,
            post_hook = function()
              vim.opt.lazyredraw = true
              vim.api.nvim_command("Beacon")
              vim.api.nvim_command("TSContextEnable")
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
        after = { "zenbones.nvim" },
        config = function()
          require("which-key").setup({
            window = {
              border = "rounded"
            }
          })
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
        event = "VimEnter",
        config = function()
          vim.g.beacon_size = 30
          vim.api.nvim_create_autocmd({ "WinEnter" }, {
            command = "Beacon",
            group = pluginGroup
          })
        end
      },
      {
        "tpope/vim-fugitive",
        ft = developmentFiles,
      },
      {
        "sindrets/diffview.nvim",
        requires = { "nvim-lua/plenary.nvim" },
        ft = developmentFiles,
        event = "CursorHold"
      },
      {
        "lukas-reineke/indent-blankline.nvim",
        ft = developmentFiles,
        event = "CursorHold"
      },
      {
        "mbbill/undotree",
        event = "VimEnter",
      },
      {
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        event = "VimEnter",
        ft = developmentFiles,
        requires = { "windwp/nvim-autopairs" },
        config = require("configs.nvim-treesitter")
      },
      {
        "nvim-treesitter/nvim-treesitter-context",
        ft = developmentFiles,
        event = "CursorHold",
        after = { "nvim-treesitter" },
        config = function()
          require("treesitter-context").setup({
            mode = "topline",
          })
        end
      },
      {
        "neovim/nvim-lspconfig",
        ft = developmentFiles,
        after = { "nvim-treesitter" },
        event = "VimEnter",
        requires = {
          "williamboman/nvim-lsp-installer",
          "junegunn/fzf",
          "windwp/nvim-ts-autotag",
          "ray-x/lsp_signature.nvim",
          "folke/lsp-colors.nvim",
          "gfanto/fzf-lsp.nvim",
          "MunifTanjim/prettier.nvim",
          "jose-elias-alvarez/null-ls.nvim",
          "jose-elias-alvarez/nvim-lsp-ts-utils",
        },
        config = require("configs.lsp")
      },
      {
        "hrsh7th/nvim-cmp",
        event = "CursorHoldI",
        after = { "nvim-treesitter" },
        requires = {
          "onsails/lspkind.nvim",
          "L3MON4D3/LuaSnip",
          "saadparwaiz1/cmp_luasnip",
          "hrsh7th/nvim-cmp",
          "hrsh7th/cmp-nvim-lsp",
          "hrsh7th/cmp-buffer",
          "hrsh7th/cmp-path",
          "hrsh7th/cmp-nvim-lua",
          "mtoohey31/cmp-fish",
        },
        config = require("configs.cmp")
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
        ft = developmentFiles,
        after = { "zenbones.nvim" },
        event = "CursorHold",
        config = function()
          require("todo-comments").setup()
        end
      },
      {
       "romgrk/barbar.nvim",
        after = { "zenbones.nvim" },
        requires = { "kyazdani42/nvim-web-devicons" },
        config = function()
          require("bufferline").setup({
            animation = false,
            icon_pinned = "",
            auto_hide = true,
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
        after = { "zenbones.nvim" },
        requires = { "kyazdani42/nvim-web-devicons", "romgrk/fzy-lua-native", "zenbones.nvim" },
        config = require("configs.wilder")
      },
      {
        "lewis6991/gitsigns.nvim",
        event = "CursorHold",
        after = { "zenbones.nvim" },
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
        after = { "zenbones.nvim" },
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.fzf")
      },
      {
        "kyazdani42/nvim-tree.lua",
        event = "VimEnter",
        after = { "zenbones.nvim" },
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.nvim-tree")
      },
    })
  end
})
