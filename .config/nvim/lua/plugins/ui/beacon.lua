require("config.pack.registry").register({
	name = "beacon.nvim",
	src = "https://github.com/DanilaMihailov/beacon.nvim.git",
	setup = function()
		local beacon = require("beacon")
		local function winblend()
			return vim.g.transparent_enabled == true and 20 or 70
		end

		beacon.setup({
			fps = 30,
			min_jump = 20,
			speed = 4,
			width = 20,
			winblend = winblend(),
		})

		local highlight_cursor = beacon.highlight_cursor
		local _, create_window = debug.getupvalue(highlight_cursor, 3)
		if type(create_window) ~= "function" then
			return
		end

		beacon.highlight_cursor = function()
			beacon.config.winblend = winblend()
			local _, fake_buffer = debug.getupvalue(create_window, 1)
			-- Beacon retains this scratch buffer, which session restoration can delete.
			if type(fake_buffer) == "number" and not vim.api.nvim_buf_is_valid(fake_buffer) then
				debug.setupvalue(create_window, 1, vim.api.nvim_create_buf(false, true))
			end

			return highlight_cursor()
		end
	end,
})

return {}
