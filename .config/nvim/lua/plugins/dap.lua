return {
  "mfussenegger/nvim-dap",
  dependencies = {
    "rcarriga/nvim-dap-ui",
    "mxsdev/nvim-dap-vscode-js",
    "nvim-dap-vscode-js",
  },
  event = "VeryLazy",
  config = function()
    local dap = require("dap")

    -- dap.set_log_level("TRACE")

    dap.adapters.chrome = {
      type = "executable",
      command = "node",
      port = 9222,
      url = "http://localhost:3000",
      args = {
        os.getenv("HOME") .. "/.local/share/nvim/mason/packages/chrome-debug-adapter/out/src/chromeDebug.js",
      },
    }

    dap.configurations.javascriptreact = {
      {
        type = "chrome",
        request = "attach",
        program = "${file}",
        cwd = vim.fn.getcwd(),
        sourceMaps = true,
        protocol = "inspector",
        port = 9222,
        webRoot = "${workspaceFolder}",
      },
    }

    dap.configurations.typescriptreact = {
      {
        type = "chrome",
        request = "attach",
        program = "${file}",
        cwd = vim.fn.getcwd(),
        sourceMaps = true,
        protocol = "inspector",
        port = 9222,
        webRoot = "${workspaceFolder}",
      },
    }

    require("dapui").setup()

    vim.api.nvim_set_hl(0, "DapBreakpoint", { ctermbg = 0, fg = "#DE6E7C" })
    vim.api.nvim_set_hl(0, "DapLogPoint", { ctermbg = 0, fg = "#97bdde" })
    vim.api.nvim_set_hl(0, "DapStopped", { ctermbg = 0, fg = "#98bd99" })
    vim.fn.sign_define(
      "DapBreakpoint",
      { text = "", texthl = "DapBreakpoint", linehl = "", numhl = "DapBreakpoint" }
    )
    vim.fn.sign_define(
      "DapBreakpointCondition",
      { text = "ﳁ", texthl = "DapBreakpoint", linehl = "DapBreakpoint", numhl = "DapBreakpoint" }
    )
    vim.fn.sign_define(
      "DapBreakpointRejected",
      { text = "", texthl = "DapBreakpoint", linehl = "DapBreakpoint", numhl = "DapBreakpoint" }
    )
    vim.fn.sign_define(
      "DapLogPoint",
      { text = "", texthl = "DapLogPoint", linehl = "DapLogPoint", numhl = "DapLogPoint" }
    )
    vim.fn.sign_define(
      "DapStopped",
      { text = "", texthl = "DapStopped", linehl = "DapStopped", numhl = "DapStopped" }
    )
  end,
}
