return function()
  local prettier = require("prettier")
  prettier.setup({
    -- ["null-ls"] = {
    --   condition = function()
    --     return prettier.config_exists({
    --       check_package_json = true
    --     })
    --   end
    -- },
    bin = "prettier",
    filetypes = {
      "css",
      "graphql",
      "html",
      "javascript",
      "javascriptreact",
      "json",
      "scss",
      "less",
      "markdown",
      "typescript",
      "typescriptreact",
      "yaml"
    },
    single_quote = true,
  })
end
