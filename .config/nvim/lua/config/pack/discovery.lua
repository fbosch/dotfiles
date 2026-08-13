local M = {}

function M.load()
	for _, category in ipairs({ "core", "ui", "lang", "workflow", "ai", "misc" }) do
		local dir = vim.fs.joinpath(vim.fn.stdpath("config"), "lua", "plugins", category)
		require("utils.fn").require_dir_modules(dir)
	end
end

return M
