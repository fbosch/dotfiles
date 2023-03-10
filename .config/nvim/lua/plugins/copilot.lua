return {
  "zbirenbaum/copilot.lua",
  cmd = "Copilot",
  event = "InsertEnter",
  config = function()
    require("copilot").setup({
      filetypes = {
        lua = true,
        javascript = true,
        javascriptreact = true,
        typescript = true,
        typescriptreact = true,
            ["*"] = false,
      },
      suggestion = {
        auto_trigger = true,
        debounce = 10,
        keymap = {
          accept = "<Tab>",
          next = "<C-j>",
          prev = "<C-k>",
          dismiss = "<C-\\>",
        },
      },
    })
  end,
}
