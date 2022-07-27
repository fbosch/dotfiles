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
local pluginGroup = vim.api.nvim_create_augroup("plugins", {})


-- install packages
return packer.startup({
  function(use)
    use({
      "wbthomason/packer.nvim",
      "lewis6991/impatient.nvim",
      "luukvbaal/stabilize.nvim",
      "antoinemadec/FixCursorHold.nvim",
      "nathom/filetype.nvim",
      {
        "tweekmonster/startuptime.vim",
        event = "VimEnter"
      },
      {
        "fedepujol/move.nvim",
        event = "BufEnter",
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
            auto_session_root_dir = vim.fn.expand('~/.config')..'/nvim/.sessions//',
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
          vim.defer_fn(function()
            require("neoscroll").setup({
              pre_hook = function()
                vim.api.nvim_command("TSContextDisable")
              end,
              post_hook = function()
                vim.api.nvim_command("Beacon")
                vim.api.nvim_command("TSContextEnable")
              end
            })
          end, 500)
        end
      },
      -- {
      --   "github/copilot.vim",
      --   event = "CursorHoldI",
      --   ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
      -- },
      {
        "phaazon/hop.nvim",
        event = "CursorHold",
        ft = developmentFiles,
        config = function()
            require("hop").setup({
              keys = "etovxqpdygfblzhckisuran"
            })
        end
      },
      {
        "folke/which-key.nvim",
        after = { "zenbones.nvim" },
        event = "VimEnter",
        config = function()
          require("which-key").setup({
            window = {
              border = "rounded"
            }
          })
        end,
      },
      {
        "akinsho/git-conflict.nvim",
        after = "zenbones.nvim",
        event = "VimEnter",
        ft = developmentFiles,
        config = function()
          vim.defer_fn(function()
            require("git-conflict").setup({
               highlights = {
                  incoming = "DiffText",
                  current = "DiffAdd",
                }
            })
            vim.api.nvim_create_autocmd({ "User" }, {
              group = pluginGroup,
              pattern = 'GitConflictDetected',
              callback = function()
                vim.notify('Conflict detected in '..vim.fn.expand('<afile>'))
                vim.keymap.set('n', 'cww', function()
                  engage.conflict_buster()
                  create_buffer_local_mappings()
                end)
              end
            })
          end, 200)
        end
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
          vim.defer_fn(function()
            require("treesitter-context").setup({
              mode = "topline",
            })
          end, 200)
        end
      },
      {
        "windwp/nvim-ts-autotag",
        event = "InsertEnter",
        ft = developmentFiles,
      },
      {
        "neovim/nvim-lspconfig",
        ft = developmentFiles,
        after = { "nvim-treesitter" },
        event = "VimEnter",
        requires = {
          "williamboman/nvim-lsp-installer",
          "junegunn/fzf",
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
        "zbirenbaum/copilot.lua",
        event = "VimEnter",
        ft = developmentFiles,
        config = function()
          vim.defer_fn(function()
            require("copilot").setup()
          end, 200)
        end,
      },
      {
        "hrsh7th/nvim-cmp",
        ft = developmentFiles,
        event = "CursorHoldI",
        after = { "nvim-treesitter", "zenbones.nvim" },
        requires = {
          "onsails/lspkind.nvim",
          "hrsh7th/nvim-cmp",
          "hrsh7th/cmp-nvim-lsp",
          "hrsh7th/cmp-buffer",
          "hrsh7th/cmp-path",
          "hrsh7th/cmp-nvim-lua",
          "mtoohey31/cmp-fish",
          {
            "zbirenbaum/copilot-cmp",
            module = "copilot_cmp"
          }
        },
        config = require("configs.cmp")
      },
      {
        "folke/trouble.nvim",
        requires = { "kyazdani42/nvim-web-devicons" },
        event = "CursorHold",
        config = function()
          vim.defer_fn(function()
            require("trouble").setup()
          end, 300)
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
          vim.defer_fn(function()
            require("todo-comments").setup()
          end, 200)
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
        event = "VimEnter",
        config = require("configs.lualine")
      },
      {
        "gelguy/wilder.nvim",
        after = { "zenbones.nvim" },
        event = "VimEnter",
        requires = { "kyazdani42/nvim-web-devicons", "romgrk/fzy-lua-native", "zenbones.nvim" },
        config = require("configs.wilder")
      },
      {
        "lewis6991/gitsigns.nvim",
        event = "CursorHold",
        after = { "zenbones.nvim" },
        ft = developmentFiles,
        config = function()
          vim.defer_fn(function()
            require("gitsigns").setup()
          end, 200)
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
