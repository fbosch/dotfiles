  return require("packer").startup({
    function(use)
        use({
            "wbthomason/packer.nvim",
            "tpope/vim-rhubarb",
            "tpope/vim-fugitive",
            "tpope/vim-commentary",
            "tpope/vim-surround",
            "tpope/vim-vinegar",
            "nathom/filetype.nvim",
            "romgrk/barbar.nvim",
            "neovim/nvim-lspconfig",
            "lewis6991/impatient.nvim",
            "lukas-reineke/indent-blankline.nvim",
            "dag/vim-fish",
            "norcalli/nvim-terminal.lua",
            "HerringtonDarkholme/yats.vim",
            "mhinz/vim-sayonara",
            "mg979/vim-visual-multi",
            "McAuleyPenney/tidy.nvim",
            "simrat39/symbols-outline.nvim",
            {
              "mcchrish/zenbones.nvim",
              requires = "rktjmp/lush.nvim"
            },
            {
              "lewis6991/gitsigns.nvim",
              config = function()
                require('gitsigns').setup()
              end
            },
            {
                "nvim-telescope/telescope.nvim",
                requires = {  "nvim-telescope/telescope-file-browser.nvim" },
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
                                find_command = { "fd", "--type", "file", "--threads=4", "-E", "*.{png,jpg,jpeg,bmp,webp,log}" },
                                previewer = false,
                                theme = "dropdown"
                            },
                            grep_string = {
                                theme = 'dropdown',
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
                    require("lualine").setup({
                        options = { theme = "auto" },
                        extensions = { "fugitive", "nvim-tree", "symbols-outline" }
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
                "ctrlpvim/ctrlp.vim",
                config = function()
                    vim.g.ctrlp_map = "<c-p>"
                    vim.g.ctrlp_cmd = "CtrlP"
                    vim.g.ctrlp_working_path_mode = "cra"
                    vim.g.ctrlp_user_command = "fd . %s --type file --threads=4 --color=never"
                end
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
                requires = {
                    'kyazdani42/nvim-web-devicons',
                },
            },
            {
                "ibhagwan/fzf-lua",
                requires = { "kyazdani42/nvim-web-devicons" }
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
                        ensure_installed = 'all',
                        highlight = { enable = true },
                        indent = { enable = true }
                    })
                end
            },
            {
                "neoclide/coc.nvim",
                branch = "release",
                config = function()
                    vim.g.coc_global_extensions = {
                        "coc-diagnostic",
                        "coc-css",
                        "coc-eslint",
                        "coc-prettier",
                        "coc-html",
                        "coc-json",
                        "coc-lua",
                        "coc-tsserver",
                        "coc-svelte"
                    }
                end
            }
        })
    end
})
