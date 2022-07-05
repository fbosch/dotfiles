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
      "rktjmp/lush.nvim",
      "tpope/vim-rhubarb",
      "tpope/vim-fugitive",
      "tpope/vim-commentary",
      "tpope/vim-surround",
      "tpope/vim-vinegar",
      "lewis6991/impatient.nvim",
      "lukas-reineke/indent-blankline.nvim",
      "mhinz/vim-sayonara",
      "mg979/vim-visual-multi",
      "simrat39/symbols-outline.nvim",
      "github/copilot.vim",
      "danilamihailov/beacon.nvim",
      "antoinemadec/FixCursorHold.nvim",
      "windwp/nvim-ts-autotag",
      "ray-x/lsp_signature.nvim",
      "folke/lsp-colors.nvim",
      "gfanto/fzf-lsp.nvim",
      "MunifTanjim/prettier.nvim",
      "f-person/git-blame.nvim",
      "onsails/lspkind.nvim",
      "L3MON4D3/LuaSnip",
      "hrsh7th/nvim-cmp",
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-path",
      "junegunn/fzf",
      "jose-elias-alvarez/null-ls.nvim",
      "jose-elias-alvarez/nvim-lsp-ts-utils",
      {
        "neovim/nvim-lspconfig",
        config = require("configs.lsp")
      },
      {
       "romgrk/barbar.nvim",
        requires = {"kyazdani42/nvim-web-devicons" },
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
        "gelguy/wilder.nvim",
        event = "VimEnter",
        requires = { "kyazdani42/nvim-web-devicons", "romgrk/fzy-lua-native" },
        config = require("configs.wilder")
      },
      {
        "mcchrish/zenbones.nvim",
        requires = "rktjmp/lush.nvim"
      },
      {
        "lewis6991/gitsigns.nvim",
        event ="CursorHold",
        config = function()
          require("gitsigns").setup()
        end
      },
      {
        "nvim-telescope/telescope.nvim",
        event = "VimEnter",
        requires = {  "nvim-telescope/telescope-file-browser.nvim",  },
        config = require("configs.telescope")
      },
      {
        "nvim-lualine/lualine.nvim",
        requires = { "kyazdani42/nvim-web-devicons", opt = true },
        config = require("configs.lualine")
      },
      {
        "startup-nvim/startup.nvim",
        requires = {"nvim-telescope/telescope.nvim", "nvim-lua/plenary.nvim"},
        config = function()
          require("startup").setup({ theme = "startup_theme" })
        end
      },
      {
        "ibhagwan/fzf-lua",
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
