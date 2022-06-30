return require("packer").startup({
    function(use)
        use({
            "wbthomason/packer.nvim",
            "MunifTanjim/prettier.nvim",
            "rktjmp/lush.nvim",
            "tpope/vim-rhubarb",
            "tpope/vim-fugitive",
            "tpope/vim-commentary",
            "tpope/vim-surround",
            "tpope/vim-vinegar",
            "nathom/filetype.nvim",
            "lewis6991/impatient.nvim",
            "lukas-reineke/indent-blankline.nvim",
            "dag/vim-fish",
            "norcalli/nvim-terminal.lua",
            "HerringtonDarkholme/yats.vim",
            "mhinz/vim-sayonara",
            "mg979/vim-visual-multi",
            "simrat39/symbols-outline.nvim",
            "github/copilot.vim",
            "windwp/nvim-ts-autotag",
            "danilamihailov/beacon.nvim",
            "f-person/git-blame.nvim",
            "jose-elias-alvarez/null-ls.nvim",
            "jose-elias-alvarez/nvim-lsp-ts-utils",
              {
              "neovim/nvim-lspconfig",
              config = function()
                local lspconfig = require("lspconfig")
                lspconfig.tailwindcss.setup({
                  cmd = { "tailwindcss-language-server", "--stdio" }
                })
                lspconfig.tsserver.setup({})
              end
            },
            {
              "hrsh7th/nvim-compe",
              config = function()
                require("compe").setup({
                  enabled = true,
                  autocomplete = true,
                  preselect = "enable",
                  source = {
                    path = true,
                    buffer = true,
                    nvim_lsp = true,
                    nvim_lua = true
                  }
                })
              end
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
              config = function()
                require("todo-comments").setup()
              end
            },
            {
              "mcauley-penney/tidy.nvim",
              config = function()
                require("tidy").setup()
              end
            },
            {
              "gelguy/wilder.nvim",
              requires = "kyazdani42/nvim-web-devicons",
              config = function()
                local wilder = require("wilder")
                wilder.setup({
                  modes = { ":", "/", "?" },
                })
                wilder.set_option("renderer", wilder.popupmenu_renderer(
                  wilder.popupmenu_border_theme({
                    border = "rounded",
                    highlighter = wilder.basic_highlighter(),
                    highlights = {
                      border = "Normal",
                      accent = wilder.make_hl("WilderAccent", "Pmenu", {{a = 1}, {a = 1}, {foreground = "#B279A7"}})
                    },
                    left = {" ", wilder.popupmenu_devicons() },
                    right = {" ", wilder.popupmenu_scrollbar() },
                  })
                ))
              end,
            },
            {
              "mcchrish/zenbones.nvim",
              requires = "rktjmp/lush.nvim"
            },
            {
              "lewis6991/gitsigns.nvim",
              config = function()
                require("gitsigns").setup()
              end
            },
            {
              "akinsho/toggleterm.nvim",
              config = function()
                require("toggleterm").setup()
              end
            },
            {
                "nvim-telescope/telescope.nvim",
                requires = {  "nvim-telescope/telescope-file-browser.nvim",  },
                config = function()
                    require("telescope").load_extension "file_browser"
                    require("telescope").setup({
                        defaults = {
                            layout_config = {
                                scroll_speed = 1.5,
                                preview_cutoff = 300
                            }
                        },
                        extensions = { file_browser = {
                                theme = "dropdown"
                            },
                        },
                        pickers = {
                            find_files = {
                                prompt_prefix = "🔍",
                                find_command = { "fd", "$(git rev-parse --show-toplevel)", "--type", "file", "--threads=8", "-E", "*.{png,jpg,jpeg,bmp,webp,log}" },
                                previewer = false,
                                theme = "dropdown"
                            },
                            grep_string = {
                                theme = "dropdown",
                                disable_coordinates = true
                            },
                            live_grep = {
                                theme = "dropdown",
                                disable_coordinates = true
                            },
                            buffers = {
                                theme = "dropdown",
                                only_cwd = true,
                                sort_mru = true
                            }
                        }
                    })
                end
            },
            {
                "nvim-lualine/lualine.nvim",
                requires = { "kyazdani42/nvim-web-devicons", opt = true },
                config = function()
                    vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
                    local git_blame = require('gitblame')
                    require("lualine").setup({
                        options = { theme = "auto" },
                        extensions = { "fugitive", "symbols-outline" },
                        sections = {
                          lualine_c = {
                            { git_blame.get_current_blame_text, cond = git_blame.is_blame_text_available }
                          }
                        }
                    })
                end
            },
            {
                "startup-nvim/startup.nvim",
                requires = {"nvim-telescope/telescope.nvim", "nvim-lua/plenary.nvim"},
                config = function()
                    require("startup").setup({
                        theme = "startup_theme"
                    })

                end
            },
            {
                "ibhagwan/fzf-lua",
                requires = { "kyazdani42/nvim-web-devicons" },
                config = function()
                  require("fzf-lua").setup({
                    files = {
                      prompt = "Files "
                    },
                    keymap = {
                      builtin = {
                        ["K"] = "preview-page-up",
                        ["J"] = "preview-page-down",
                      },
                    },
                  })
                end
            },
            -- {
            --     "windwp/nvim-autopairs",
            --     event = "InsertEnter",
            --     config = function()
            --       require("nvim-autopairs").setup()
            --     end
            -- },
            {
                "kyazdani42/nvim-tree.lua",
                requires = {
                    "kyazdani42/nvim-web-devicons",
                },
                config = function()
                  require("nvim-tree").setup({})
                  local tree_events = require("nvim-tree.events")
                  local bufferline_state = require("bufferline.state")
                  tree_events.on_tree_open(function()
                       bufferline_state.set_offset(31, "FileTree")
                  end)
                  tree_events.on_tree_close(function()
                      bufferline_state.set_offset(0)
                  end)
                end
            },
            {
                "jghauser/kitty-runner.nvim",
                config = function()
                    require("kitty-runner").setup()
                end
            },
            {
                "nvim-treesitter/nvim-treesitter",
                run = ":TSUpdate",
                config = function()
                    require("nvim-treesitter.configs").setup({
                        autopairs = { enable = true },
                        autotag = { enable = true },
                        ensure_installed = "all",
                        highlight = { enable = true },
                        indent = { enable = true }
                    })
                end
            },
            -- {
            --     "neoclide/coc.nvim",
            --     branch = "release",
            --     config = function()
            --         vim.g.coc_global_extensions = {
            --             "coc-diagnostic",
            --             "coc-css",
            --             "coc-eslint",
            --             "coc-prettier",
            --             "coc-html",
            --             "coc-json",
            --             "coc-lua",
            --             "coc-tsserver",
            --             "coc-svelte",
            --             "@yaegassy/coc-tailwindcss3",
            --         }
            --     end
            -- },
        })
    end
})
