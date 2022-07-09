-- Use a protected call so we don't error out on first use
local status_ok, packer = pcall(require, "packer")
if not status_ok then
	return
end

-- Have packer use a popup window
packer.init({
	display = {
		open_fn = function()
			return require("packer.util").float({ border = "rounded" })
		end,
	},
})

-- install packages
return packer.startup({
  function(use)
    use({
      "wbthomason/packer.nvim",
      "lewis6991/impatient.nvim",
      "tweekmonster/startuptime.vim",
      "antoinemadec/FixCursorHold.nvim",
      {
        "rmagatti/auto-session",
        config = function()
          require("auto-session").setup({
            log_level = "error",
          })
        end
      },
      {
        "github/copilot.vim",
        ft = { "html", "css", "javascript", "javascriptreact", "typescript", "typescriptreact", "json", "lua" }
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
        "tpope/vim-vinegar",
        event = "VimEnter"
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
        "mhinz/vim-sayonara",
        event = "VimEnter",
      },
      {
        "danilamihailov/beacon.nvim",
        event = "CursorHold"
      },
      { 
        "tpope/vim-fugitive", 
        event = "VimEnter"
      },
      {
        "lukas-reineke/indent-blankline.nvim",
        event = "CursorHold"
      },
      { 
        "PHSix/faster.nvim",
        event = "CursorHold",
        config = function()
          vim.api.nvim_set_keymap('n', 'j', '<Plug>(faster_move_j)', {noremap=false, silent=true})
          vim.api.nvim_set_keymap('n', 'k', '<Plug>(faster_move_k)', {noremap=false, silent=true})
        end
      },
      {
        "neovim/nvim-lspconfig",
        requires = {
          "junegunn/fzf",
          "windwp/nvim-ts-autotag",
          "ray-x/lsp_signature.nvim",
          "folke/lsp-colors.nvim",
          "gfanto/fzf-lsp.nvim",
          "MunifTanjim/prettier.nvim",
          "onsails/lspkind.nvim",
          "L3MON4D3/LuaSnip",
          "hrsh7th/nvim-cmp",
          "hrsh7th/cmp-nvim-lsp",
          "hrsh7th/cmp-buffer",
          "hrsh7th/cmp-path",
          "jose-elias-alvarez/null-ls.nvim",
          "jose-elias-alvarez/nvim-lsp-ts-utils",
        },
        config = require("configs.lsp")
      },
      {
       "romgrk/barbar.nvim",
        requires = {"kyazdani42/nvim-web-devicons" },
      },
      {
        "folke/trouble.nvim",
        requires = { "kyazdani42/nvim-web-devicons" },
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
        event = "CursorHold",
        config = function()
          require("todo-comments").setup()
        end
      },
      {
        "mcchrish/zenbones.nvim",
        requires = "rktjmp/lush.nvim"
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
        config = function()
          require("gitsigns").setup()
        end
      },
      {
        "nvim-telescope/telescope.nvim",
        requires = {  "nvim-telescope/telescope-file-browser.nvim"  },
        config = require("configs.telescope")
      },
      {
        "nvim-lualine/lualine.nvim",
        requires = { "kyazdani42/nvim-web-devicons", opt = true },
        config = require("configs.lualine")
      },
      {
        "ibhagwan/fzf-lua",
        event = "VimEnter",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.fzf")
      },
      {
        "windwp/nvim-autopairs",
        event = "InsertEnter",
        config = function()
          require("nvim-autopairs").setup()
        end
      },
      {
        "kyazdani42/nvim-tree.lua",
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.nvim-tree")
      },
      {
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        config = require("configs.nvim-treesitter")
      },
    })
  end
})
