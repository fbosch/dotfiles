return {
  "ThePrimeagen/git-worktree.nvim",
  event = "VeryLazy",
  config = function()
    local worktree = require("git-worktree")

    function string_diff(str1, str2)
      local len1 = string.len(str1)
      local len2 = string.len(str2)
      local diff = ""

      for i = 1, math.max(len1, len2) do
        local char1 = string.sub(str1, i, i)
        local char2 = string.sub(str2, i, i)

        if char1 ~= char2 then
          diff = diff .. char1
        end
      end

      return diff
    end

    worktree.setup({})
    worktree.on_tree_change(function(op, metadata)
      if op == worktree.Operations.Switch then
        local sessionFile =
            vim.fn.expand("~/.config/nvim/.sessions/" .. string.gsub(metadata.path, "\\/", "%") .. ".vim")

        vim.cmd(":RestoreSessionFromFile " .. sessionFile)
        local from = string_diff(metadata.prev_path, metadata.path)
        local to = string_diff(metadata.path, metadata.prev_path)

        if from ~= to then
          vim.notify(" " .. from .. "    " .. to, "info", {
            title = "Worktree",
            icon = "",
          })
        end
      end
    end)
  end,
}
