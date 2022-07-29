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
local function lazyPlugin(plugin)
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
      "luukvbaal/stabilize.nvim",
      "antoinemadec/FixCursorHold.nvim",
      "nathom/filetype.nvim",
      lazyPlugin("tpope/vim-fugitive"),
      lazyPlugin("mbbill/undotree"),
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
          })
        end
      },
      {
        "fedepujol/move.nvim",
        ft = developmentFiles,
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
        requires = { lazyPlugin("rktjmp/lush.nvim") },
        event = "VimEnter",
        config = require("configs.colorscheme")
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
                vim.api.nvim_command("TSContextEnable")
              end
            })
          end, 300)
        end
      },
      {
        "github/copilot.vim",
        event = "CursorHoldI",
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
          vim.g.beacon_enable = 0
          vim.defer_fn(function()
            vim.schedule(function()
              vim.g.beacon_ignore_filetypes = { "fzf" }
              vim.g.beacon_size = 30
              vim.g.beacon_enable = 1
              vim.schedule(function()
                vim.api.nvim_create_autocmd({ "WinEnter" }, {
                  command = "Beacon",
                  group = pluginGroup
                })
              end)
            end)
          end, 500)
        end
      },
      {
        "sindrets/diffview.nvim",
        requires = { lazyPlugin("nvim-lua/plenary.nvim") },
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
        ft = developmentFiles,
        requires = { lazyPlugin("windwp/nvim-autopairs") },
        config = require("configs.nvim-treesitter")
      },
      {
        "nvim-treesitter/nvim-treesitter-context",
        ft = developmentFiles,
        event = "CursorHold",
        after = { "nvim-treesitter" },
        config = function()
          vim.defer_fn(function()
            vim.schedule(function()
              require("treesitter-context").setup({
                mode = "topline",
              })
            end)
          end, 200)
        end
      },
      {
        "windwp/nvim-ts-autotag",
        ft = developmentFiles,
        event = "InsertEnter",
      },
      {
        "neovim/nvim-lspconfig",
        ft = developmentFiles,
        after = { "nvim-treesitter" },
        event = "VimEnter",
        requires = {
          "jose-elias-alvarez/nvim-lsp-ts-utils",
          lazyPlugin("williamboman/nvim-lsp-installer"),
          lazyPlugin("junegunn/fzf"),
          lazyPlugin("ray-x/lsp_signature.nvim"),
          lazyPlugin("folke/lsp-colors.nvim"),
          lazyPlugin("gfanto/fzf-lsp.nvim"),
          lazyPlugin("MunifTanjim/prettier.nvim"),
          lazyPlugin("jose-elias-alvarez/null-ls.nvim"),
        },
        config = require("configs.lsp")
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
        event = "CursorHoldI",
        after = { "nvim-treesitter", "zenbones.nvim" },
        requires = {
          "onsails/lspkind.nvim",
          "hrsh7th/nvim-cmp",
          lazyPlugin("saadparwaiz1/cmp_luasnip"),
          lazyPlugin("hrsh7th/cmp-nvim-lsp"),
          lazyPlugin("hrsh7th/cmp-path"),
          lazyPlugin("hrsh7th/cmp-nvim-lua"),
          lazyPlugin("mtoohey31/cmp-fish"),
          lazyPlugin("hrsh7th/cmp-buffer"),
        },
        config = require("configs.cmp")
      },
      {
        "folke/trouble.nvim",
        requires = { lazyPlugin("kyazdani42/nvim-web-devicons") },
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
          vim.schedule(function()
            vim.g.Hexokinase_highlighters = {"virtual"}
            vim.g.Hexokinase_optInPatterns = {
              "full_hex", "rgb", "rgba", "hsl", "hsla"
            }
          end)
        end
      },
      {
        "folke/todo-comments.nvim",
        requires = {
          lazyPlugin("nvim-lua/plenary.nvim"),
        },
        ft = developmentFiles,
        after = { "zenbones.nvim" },
        event = "CursorHold",
        config = function()
          vim.schedule(function()
            require("todo-comments").setup()
          end)
        end
      },
      {
        "nvim-lualine/lualine.nvim",
        requires = {
          lazyPlugin("kyazdani42/nvim-web-devicons"),
          lazyPlugin("f-person/git-blame.nvim")
        },
        after = { "lush.nvim" },
        event = "VimEnter",
        config = require("configs.lualine")
      },
      {
        "gelguy/wilder.nvim" ,
        after = { "zenbones.nvim" },
        event = "VimEnter",
        requires = {
          lazyPlugin("kyazdani42/nvim-web-devicons"),
          lazyPlugin("romgrk/fzy-lua-native")
        },
        config = require("configs.wilder")
      },
      {
        "lewis6991/gitsigns.nvim",
        event = "CursorHold",
        after = { "zenbones.nvim" },
        ft = developmentFiles,
        config = function()
          vim.schedule(function()
            require("gitsigns").setup()
          end)
        end
      },
      {
        "nvim-telescope/telescope.nvim",
        event = "VimEnter",
        requires = { lazyPlugin("nvim-telescope/telescope-file-browser.nvim")  },
        config = require("configs.telescope")
      },
      {
        "ibhagwan/fzf-lua",
        event = "VimEnter",
        after = { "zenbones.nvim" },
        requires = { lazyPlugin("kyazdani42/nvim-web-devicons") },
        config = require("configs.fzf")
      },
      {
        "kyazdani42/nvim-tree.lua",
        event = "VimEnter",
        after = { "zenbones.nvim", "barbar.nvim" },
        requires = { "kyazdani42/nvim-web-devicons" },
        config = require("configs.nvim-tree")
      },
    })
  end
})
