local root = assert(vim.env.PI_ASK_FIXTURE_ROOT)
local config = assert(vim.env.PI_ASK_FIXTURE_CONFIG)
package.path = config .. "/lua/?.lua;" .. config .. "/lua/?/init.lua;" .. package.path
vim.cmd.cd(root)
local source = vim.api.nvim_create_buf(true, false)
vim.api.nvim_buf_set_name(source, root .. "/example.lua")
vim.api.nvim_buf_set_lines(source, 0, -1, false, { "første æøå", "anden" })
vim.api.nvim_set_current_buf(source)
local window = vim.api.nvim_get_current_win()
local session = dofile(config .. "/lua/utils/session.lua")
local owner = { cwd = root, metadata_path = root .. "/metadata.json", specifier = "fixture-owner" }
session.set_current(owner)
session.set_metadata({}, owner)
package.loaded["utils.session"] = session
local terminal
local fail_first_open = vim.env.PI_ASK_FIXTURE_FAIL_FIRST_OPEN == "1"
package.loaded["snacks.terminal"] = {
	open = function(command, options)
		if fail_first_open then
			fail_first_open = false
			return nil
		end
		terminal = { buf = vim.api.nvim_create_buf(false, true), command = command }
		function terminal:buf_valid()
			return vim.api.nvim_buf_is_valid(self.buf)
		end
		function terminal:valid()
			return true
		end
		function terminal:on() end
		function terminal:show()
			return self
		end
		function terminal:focus()
			return self
		end
		options.win.on_buf(terminal)
		return terminal
	end,
}
local executable = vim.fn.executable
rawset(vim.fn, "executable", function(name)
	return name == "pi" and 1 or executable(name)
end)
local pi = require("plugins.ai.pi")
local location = assert(require("plugins.ai.pi.bridge").capture_prompt_location())
local bind = pi.bind_session
pi.bind_session = function(binding)
	if vim.env.PI_ASK_FIXTURE_BINDING ~= nil then
		return vim.json.decode(vim.env.PI_ASK_FIXTURE_BINDING)
	end
	local result = bind(binding)
	if type(result) == "table" and vim.env.PI_ASK_FIXTURE_NO_PROMPT ~= "1" then
		vim.schedule(function()
			vim.api.nvim_set_current_win(window)
			assert(pi.submit_prompt("explain æøå", location))
		end)
	end
	return result
end
local done = false
local acknowledge = pi.prompt_acknowledge
pi.prompt_acknowledge = function(payload, channel)
	local accepted = acknowledge(payload, channel)
	if accepted then
		io.stdout:write(vim.json.encode({ acknowledged = payload }) .. "\n")
		io.stdout:flush()
		done = true
	end
	return accepted
end
if vim.env.PI_ASK_FIXTURE_FAIL_FIRST_OPEN == "1" then
	assert(not pcall(pi.start), "first terminal open unexpectedly succeeded")
end
assert(pi.start())
local ready = {
	socket = assert(terminal.command:match("PI_NVIM_SOCKET='([^']+)'")),
	launchId = assert(terminal.command:match("PI_NVIM_LAUNCH_ID='([a-f0-9]+)'")),
	cwd = root,
}
io.stdout:write(vim.json.encode(ready) .. "\n")
io.stdout:flush()
assert(
	vim.wait(30000, function()
		return done
	end, 10),
	"fixture timed out"
)
vim.cmd("qa!")
