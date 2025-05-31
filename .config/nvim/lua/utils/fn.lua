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

function M.contains_any(subject, pattern)
	if type(subject) ~= "table" or type(pattern) ~= "table" then
		return false
	end
	local subject_set = {}
	for _, v in ipairs(subject) do
		subject_set[v] = true
	end
	for _, v in ipairs(pattern) do
		if subject_set[v] then
			return true
		end
	end
	return false
end

function M.classify(subject, cases)
	for _, case in ipairs(cases) do
		local pattern, result = case[1], case[2]
		if pattern == nil then -- default case
			return type(result) == "function" and result(subject) or result
		elseif type(pattern) == "table" and type(subject) == "table" then
			if M.contains_any(subject, pattern) then
				return type(result) == "function" and result(subject) or result
			end
		elseif subject == pattern then
			return type(result) == "function" and result(subject) or result
		end
	end
	return nil
end

function M.tables_equal(t1, t2)
	if type(a) ~= "table" or type(b) ~= "table" then
		return false
	end
	if #a ~= #b then
		return false
	end
	for i = 1, #a do
		if a[i] ~= b[i] then
			return false
		end
	end
	return true
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
