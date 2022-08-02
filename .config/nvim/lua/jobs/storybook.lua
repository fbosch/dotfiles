local group = vim.api.nvim_create_augroup("storybook", {})


return function()
  local job = require("luajob")
  local yarnStorybook = job:new({
    cmd = "yarn storybook",
    on_stdout = function(err, data)
      if data then
        if string.match(data, "for React started") then
          vim.schedule(function()
            vim.notify(data, "info", {
              title = "Storybook",
              icon = ""
            })
          end)
        end
      end
    end
  })
  vim.schedule(yarnStorybook.start)
  vim.api.nvim_create_autocmd({ "VimLeavePre" }, {
    callback = function()
      -- force kill process on close
      vim.schedule(function()
        os.execute("ps -ef | grep -i \"$(pwd)\" | grep \"storybook\" | awk '{print $2}' | xargs kill -9")
        yarnStorybook.stop()
        yarnStorybook.shutdown()
      end)
    end,
    group = group
  })
end
