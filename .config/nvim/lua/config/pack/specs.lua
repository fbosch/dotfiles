local M = {}

function M.get()
	local lazy_plugins = require("lazy.core.config").plugins
	local lock_path = vim.fs.joinpath(vim.fn.stdpath("config"), "lazy-lock.json")
	local lock = vim.json.decode(table.concat(vim.fn.readfile(lock_path), "\n"))
	local specs = {}

	for name, plugin in pairs(lazy_plugins) do
		if name ~= "lazy.nvim" then
			local locked = assert(lock[name], "missing Lazy lock entry for " .. name)
			assert(type(plugin.url) == "string", "missing resolved source URL for " .. name)
			assert(type(locked.commit) == "string", "missing locked revision for " .. name)

			table.insert(specs, {
				name = name,
				src = plugin.url,
				version = locked.commit,
			})
		end
	end

	table.sort(specs, function(left, right)
		return left.name < right.name
	end)
	assert(#specs == 69, ("expected 69 application plugins, got %d"):format(#specs))

	return specs
end

return M
