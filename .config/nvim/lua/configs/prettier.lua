return function()
  local prettier = require("prettier")
  prettier.setup({
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
