local M = {}

function M.merge_tables(...)
	local merged = {}
	for _, table in ipairs({ ... }) do
		for key, value in pairs(table) do
			merged[key] = value
		end
	end

	return merged
end

function M.infer_require_prefix(dir)
	local lua_root = vim.fn.stdpath("config") .. "/lua/"
	local rel = dir:sub(#lua_root + 1)
	return rel:gsub("/", ".")
end

function M.require_dir_modules(dir)
	local modules = {}
	local require_prefix = M.infer_require_prefix(dir)
	local files = vim.fn.globpath(dir, "*.lua", false, true)
	table.sort(files)
	for _, file in ipairs(files) do
		local fname = vim.fn.fnamemodify(file, ":t:r")
		if fname ~= "init" then
			local modname = require_prefix .. "." .. fname
			table.insert(modules, require(modname))
		end
	end
	return modules
end

function M.switch(param, t)
	local case = t[param]
	if case ~= nil then
		return type(case) == "function" and case() or case
	end
	local default = t["default"]
	return type(default) == "function" and default() or default
end

return M
