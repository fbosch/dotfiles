local group = vim.api.nvim_create_augroup("devserver", {})


return function()
  local job = require('.jobs.job')
  local yarnDev = job:new({
    cmd = "yarn dev",
    on_stdout = function(self, err, data)
      vim.schedule(function()
        if (err) then
          vim.notify(err, "error", {
            title = "Dev Server"
          })
        elseif data then
          if string.match(data, "reload") then
            vim.notify({ " 勒Page Reloaded" }, "info", {
              render = "minimal",
              timeout = 100
            })
          elseif string.match(data, "hmr") then
            vim.notify("  Hot Module Reload", "info", {
              render = "minimal",
              timeout = 100,
            })
          else
            vim.notify(data, "info", {
              title = "Dev Server",
              icon = "",
              timeout = 250
            })
          end
        end
      end)
    end
  })
  vim.schedule(function()
    vim.notify("  Starting Dev Server", "info", {
      render = "minimal",
      timeout = 100
    })
  end)
  vim.schedule(yarnDev.start)
  vim.api.nvim_create_autocmd({ "VimLeavePre" }, {
    callback = function()
      -- force kill process on close
      vim.schedule(function()
        os.execute("ps -ef | grep -i \"$(pwd)\" | grep \"dev\\|vite\" | awk '{print $2}' | xargs kill -9")
        yarnDev.stop()
        yarnDev.shutdown()
      end)
    end,
    group = group
  })
end
