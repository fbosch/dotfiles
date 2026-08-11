return {
	{
		"DanilaMihailov/beacon.nvim",
		event = "VeryLazy",
		config = function()
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

			-- Beacon retains this scratch buffer after windows are restored.
			local _, create_window = debug.getupvalue(beacon.highlight_cursor, 3)
			if type(create_window) ~= "function" then
				return
			end

			vim.api.nvim_create_autocmd({ "WinEnter", "FocusGained" }, {
				callback = function()
					beacon.config.winblend = winblend()
					local _, fake_buffer = debug.getupvalue(create_window, 1)
					if type(fake_buffer) ~= "number" or vim.api.nvim_buf_is_valid(fake_buffer) then
						return
					end

					debug.setupvalue(create_window, 1, vim.api.nvim_create_buf(false, true))
				end,
			})
		end,
	},
}
