local group = vim.api.nvim_create_augroup("test", {})


return function()
  local job = require("luajob")
  local yarnTest = job:new({
    cmd = "yarn test",
    on_stdout = function(err, data)
      if data then
        if string.match(data, "exit code 0") then
          vim.schedule(function()
            vim.notify(data, "info", {
              title = "Tests",
              icon = "ﭧ"
            })
          end)
        elseif string.match(data, "FAIL") then
          vim.schedule(function()
            vim.notify(data, "warn", {
              title = "Tests",
              icon = "ﭧ"
            })
          end)
        end
      end
    end
  })
  vim.schedule(yarnTest.start)
  vim.schedule_wrap(vim.notify(" ﭧ Running Test Suite", "info", {
    render = "minimal",
    timeout = 100
  }))
  vim.api.nvim_create_autocmd({ "VimLeavePre" }, {
    callback = function()
      -- force kill process on close
      vim.schedule(function()
        os.execute("ps -ef | grep -i \"$(pwd)\" | grep \"test\" | awk '{print $2}' | xargs kill -9")
        yarnTest.stop()
        yarnTest.shutdown()
      end)
    end,
    group = group
  })
end
