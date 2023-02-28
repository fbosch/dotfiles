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

local developmentFiles = { "html", "css", "javascript", "javascriptreact", "typescript", "typescriptreact", "json", "lua", "markdown" }
local pluginGroup = vim.api.nvim_create_augroup("plugins", {})
local function lazy(plugin)
  return {
    plugin,
    event = "VimEnter",
    ft = developmentFiles,
  }
end

-- install packages
return packer.startup({
  function(use)
    use({
      "tweekmonster/startuptime.vim",
      "wbthomason/packer.nvim",
      "lewis6991/impatient.nvim",
      "antoinemadec/FixCursorHold.nvim",
      "nathom/filetype.nvim",
      "tpope/vim-fugitive",
      "voldikss/vim-floaterm",
      {
        "j-hui/fidget.nvim",
        config = function() 
          require("fidget").setup()
        end
      },
      {
        "ray-x/sad.nvim",
        requires = { "ray-x/guihua.lua", run = "cd lua/fzy && make" },
        config = function()
          require("sad").setup()
        end
      },
      {
        "stevearc/dressing.nvim",
        event = "VimEnter",
        config = 
          require("configs.dressing")
     },
     {
        "stevearc/overseer.nvim",
        event = "VimEnter",
        config = require("configs.overseer")
      },
      {
       "gbrlsnchs/winpick.nvim",
        event = "VimEnter",
        config = function()
          require("winpick").setup({
            border = "rounded",
            chars = { "W", "Q", "E", "A", "S", "D", "R", "F", "T", "G" }
          })
        end
      },
      {
       "rcarriga/nvim-notify",
        event = "VimEnter",
        config = require("configs.notify")
      },
      {
        "mbbill/undotree",
        event = "VimEnter",
        config = function()
          vim.g.undotree_WindowLayout = 2
        end
      },
      {
        "rmagatti/auto-session",
        event = "VimEnter",
        config = function()
          require("auto-session").setup({
            auto_session_root_dir = vim.fn.expand('~/.config')..'/nvim/.sessions//',
            log_level = "error",
          })
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
            maximum_padding = 6,
            diagnostics = {
              [vim.diagnostic.severity.ERROR] = {enabled = true, icon = ''},
              [vim.diagnostic.severity.WARN] = {enabled = true, icon = ''},
              [vim.diagnostic.severity.INFO] = {enabled = true, icon = ''},
              [vim.diagnostic.severity.HINT] = {enabled = true, icon = ''},
            }
          })
        end
      },
      {
        "fedepujol/move.nvim",
        ft = developmentFiles,
        event = "VimEnter",
     },
      -- {
      --   "echasnovski/mini.nvim",
      --   event = "CursorHold",
      --   config = function()
      --     require('mini.ai').setup()
      --     require("mini.trailspace").setup({
      --       only_in_normal_buffers = true
      --     })
      --   end
      -- },
      {
        "mcchrish/zenbones.nvim",
        requires = { lazy("rktjmp/lush.nvim") },
        config = function()
          vim.cmd("colorscheme zenwritten")
          vim.schedule(require("configs.colorscheme"))
        end
      },
      {
        "github/copilot.vim",
        event = "CursorHoldI",
        ft = developmentFiles,
        ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
      },
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
          vim.schedule(function()
            require("which-key").setup({
              window = {
                border = "rounded"
              }
            })
          end)
        end,
      },
      {
        "kwkarlwang/bufresize.nvim",
        event = "VimEnter",
        config = function() 
          require("bufresize").setup()
        end
      },
      {
        "mrjones2014/smart-splits.nvim",
        event = "VimEnter",
        after = { "bufresize.nvim" },
        config = function()
          require("smart-splits").setup({
              resize_mode = {
              hooks = {
                on_leave = require('bufresize').register,
              },
            },
          })
        end
      },
      {
        "tpope/vim-commentary",
        event = "CursorHold",
        ft = developmentFiles
      },
      {
        "tpope/vim-surround",
        ft = developmentFiles,
        event = "InsertEnter",
      },
      {
        "lukas-reineke/indent-blankline.nvim",
        event = "CursorHold",
      },
      {
        "danilamihailov/beacon.nvim",
        event = "VimEnter",
        config = function()
          vim.g.beacon_enable = 0
          vim.g.beacon_ignore_filetypes = { "fzf" }
          vim.g.beacon_size = 30
          vim.g.beacon_enable = 1
          vim.schedule(function()
            vim.api.nvim_create_autocmd({ "WinEnter" }, {
              command = "Beacon",
              group = pluginGroup
            })
          end)
        end
      },
      {
        "sindrets/diffview.nvim",
        requires = { lazy("nvim-lua/plenary.nvim") },
        ft = developmentFiles,
        event = "CursorHold"
      },
      {
        "nvim-treesitter/nvim-treesitter",
        run = ":TSUpdate",
        ft = developmentFiles,
        requires = { "windwp/nvim-autopairs" },
        config = require("configs.nvim-treesitter")
      },
      -- {
      --   "folke/zen-mode.nvim",
      --   event = "CursorHold",
      --   ft = developmentFiles,
      --   config = function() 
      --     require("zen-mode").setup({
      --       plugins = {
      --         kitty = {
      --           enabled = true,
      --           font = "+4",
      --         }
      --       }
      --     })
      --   end
      -- },
      -- {
      --   "folke/twilight.nvim",
      --   ft = developmentFiles,
      --   event = "CursorHold",
      --   requires = { "nvim-treesitter/nvim-treesitter" },
      --   config = function()
      --     require("twilight").setup({
      --       context = 8,
      --       inactive = true,
      --       term_bg = "#181818",
      --       treesitter = true,
      --     })
      --   end
      -- },
      {
        "neovim/nvim-lspconfig",
        ft = developmentFiles,
        requires = {
          "williamboman/mason.nvim",
          "lukas-reineke/lsp-format.nvim",
          "jose-elias-alvarez/nvim-lsp-ts-utils",
          "junegunn/fzf",
          "folke/lsp-colors.nvim",
          "gfanto/fzf-lsp.nvim",
          "MunifTanjim/prettier.nvim",
          "jose-elias-alvarez/null-ls.nvim",
        },
        config = require("configs.lsp")
      },
      {
        "DNLHC/glance.nvim",
        ft = developmentFiles,
        event = "CursorHold",
        config = function()
          require("glance").setup({
            height = 18,
            width = 60,
            border = {
              enable = true
            }
          })
        end
      },
      {
        "anuvyklack/pretty-fold.nvim",
        ft = developmentFiles,
        config = function()
          require("pretty-fold").setup({
            fill_char = "‗",
          })
        end
      },
      {
        "utilyre/barbecue.nvim",
        tag = "*",
        event = "VimEnter",
        requires = {
          "SmiteshP/nvim-navic",
          "nvim-tree/nvim-web-devicons", -- optional dependency
        },
        after = "nvim-web-devicons", -- keep this if you're using NvChad
        config = require("configs.barbecue")
      },
      {
        "anuvyklack/fold-preview.nvim",
        ft = developmentFiles,
        requires = 'anuvyklack/keymap-amend.nvim',
        config = function() 
          require("fold-preview").setup({
            border = 'rounded'
          })
        end
      },
      {
        "L3MON4D3/LuaSnip",
        ft = developmentFiles,
        after = { "nvim-treesitter" },
        event = "CursorHold"
      },
      {
        "hrsh7th/nvim-cmp",
        ft = developmentFiles,
        after = { "nvim-treesitter", "zenbones.nvim" },
        requires = {
          "onsails/lspkind.nvim",
          "hrsh7th/nvim-cmp",
          {
            "f3fora/cmp-spell",
            ft = { "markdown" },
            event = "VimEnter",
          },
          {
            "mtoohey31/cmp-fish",
            event = "VimEnter",
            ft = { "fish" }
          },
          {
            "hrsh7th/cmp-nvim-lua",
            event = "VimEnter",
            ft = { "lua" }
          },
          lazy("hrsh7th/cmp-emoji"),
          lazy("saadparwaiz1/cmp_luasnip"),
          lazy("hrsh7th/cmp-nvim-lsp"),
          lazy("hrsh7th/cmp-path"),
          lazy("hrsh7th/cmp-buffer"),
        },
        config = require("configs.cmp")
      },
      -- {
      --   "rcarriga/nvim-dap-ui",
      --   ft = developmentFiles,
      --   requires = { "mfussenegger/nvim-dap" },
      --   event = "VimEnter",
      --   config = function()
      --     vim.schedule(function()
      --       require("dapui").setup()
      --     end)
      --   end
      -- },
      -- {
      --   "mfussenegger/nvim-dap",
      --   ft = developmentFiles,
      --   event = "VimEnter"
      -- },
      {
        "folke/trouble.nvim",
        requires = { lazy("kyazdani42/nvim-web-devicons") },
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
        "chentoast/marks.nvim",
        ft = developmentFiles,
        config = function()
          require('marks').setup({
             bookmark_0 = {
              sign = "",
            },
          })
        end
      },
      {
        "folke/todo-comments.nvim",
        requires = {
          lazy("nvim-lua/plenary.nvim"),
        },
        ft = developmentFiles,
        after = { "zenbones.nvim" },
        event = "ColorSchemePre",
        config = function()
          require("todo-comments").setup()
        end
      },
      {
        "Mofiqul/vscode.nvim",
        event = "ColorSchemePre",
      },
      {
        "nvim-lualine/lualine.nvim",
        event = "ColorSchemePre",
        requires = {
          "kyazdani42/nvim-web-devicons",
          "f-person/git-blame.nvim"
        },
        config = require("configs.lualine")
      },
      {
        "gelguy/wilder.nvim" ,
        after = { "zenbones.nvim" },
        event = "ColorSchemePre",
        requires = {
          lazy("kyazdani42/nvim-web-devicons"),
          lazy("romgrk/fzy-lua-native")
        },
        config = require("configs.wilder")
      },
      {
        "lewis6991/gitsigns.nvim",
        event = "ColorSchemePre",
        after = { "zenbones.nvim" },
        ft = developmentFiles,
        config = function()
          require("gitsigns").setup()
        end
          },
      {
        "nvim-telescope/telescope.nvim",
        event = "VimEnter",
        requires = { "nvim-telescope/telescope-file-browser.nvim", "kdheepak/lazygit.nvim" },
        config = require("configs.telescope")
      },
      {
        "ibhagwan/fzf-lua",
        -- event = "VimEnter",
        after = { "zenbones.nvim" },
        requires = { lazy("kyazdani42/nvim-web-devicons") },
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


