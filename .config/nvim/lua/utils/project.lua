local M = {}

local __package_json_cache = {}

function M.has_file(dir, name)
	return vim.fn.filereadable(dir .. "/" .. name) == 1
end

function M.has_any_file(dir, names)
	for _, name in ipairs(names) do
		if M.has_file(dir, name) then
			return true
		end
	end
	return false
end

function M.has_dep(pkg, dep)
	if not pkg then
		return false
	end
	local all_deps = vim.tbl_extend("force", pkg.dependencies or {}, pkg.devDependencies or {})
	return all_deps[dep] ~= nil
end

function M.read_package_json(dir)
	if __package_json_cache[dir] ~= nil then
		return __package_json_cache[dir]
	end
	if not M.has_file(dir, "package.json") then
		return nil
	end
	local path = dir .. "/package.json"
	local content = vim.fn.readfile(path)
	if not content or #content == 0 then
		return nil
	end
	local ok, decoded = pcall(vim.fn.json_decode, table.concat(content, "\n"))
	return ok and decoded or nil
end

local detectors = {
	lua = function(dir)
		return M.has_file(dir, "init.lua")
	end,
	nextjs = function(_, pkg)
		return M.has_dep(pkg, "next")
	end,
	react = function(_, pkg)
		return M.has_dep(pkg, "react")
	end,
	astro = function(_, pkg)
		return M.has_dep(pkg, "astro")
	end,
	bun = function(dir)
		return M.has_file(dir, "bun.lock")
	end,
	typescript = function(dir, pkg)
		return M.has_dep(pkg, "typescript") or M.has_file(dir, "tsconfig.json")
	end,
	vite = function(dir, pkg)
		return M.has_dep(pkg, "vite") or M.has_file(dir, "vite.config.js")
	end,
	rust = function(dir)
		return M.has_file(dir, "Cargo.toml")
	end,
}

function M.get_project_types()
	local dir = vim.fn.getcwd()
	local checked_dirs = {}
	local matches = {}
	while dir and dir ~= "/" do
		-- Avoid rechecking the same directory if the user has symlinked/circular paths
		if checked_dirs[dir] then
			break
		end
		checked_dirs[dir] = true

		local pkg = M.read_package_json(dir)
		for project, detector in pairs(detectors) do
			if not vim.tbl_contains(matches, project) and detector(dir, pkg) then
				table.insert(matches, project)
			end
		end
		local parent = vim.fn.fnamemodify(dir, ":h")
		if parent == dir then
			break
		end
		dir = parent
	end
	if #matches == 0 then
		return { "unknown" }
	end
	return matches
end

function M.get_project_root()
	local root_bare = vim.fs.root(vim.fn.getcwd(), { ".bare" }) -- support for worktrees
	local root_other = vim.fs.root(
		vim.fn.getcwd(),
		{ "dekit.yaml", "package.json", ".git", "Cargo.toml", "justfile", "Justfile", ".justfile" }
	)

	return root_other or root_bare
end

function M.find_file_in_project_root(pattern)
	local root = M.get_project_root()
	if not root or not pattern then
		return nil
	end

	for _, fname in ipairs(pattern) do
		local candidate = root .. "/" .. fname
		if vim.uv.fs_stat(candidate) then
			return candidate
		end
	end
end

function M.resolve_dekit_command(cwd)
	local args = {}
	for _, name in ipairs({ "mprocs.yaml", "mprocs.yml" }) do
		if M.has_file(cwd, name) then
			table.insert(args, "--config " .. vim.fn.shellescape(cwd .. "/" .. name))
			break
		end
	end
	if M.has_any_file(cwd, { "justfile", "Justfile", ".justfile" }) then
		table.insert(args, "--just")
	elseif #args == 0 and M.has_file(cwd, "package.json") then
		table.insert(args, "--npm")
	end

	-- Only the bundled mprocs UI can list recipes/scripts without starting them.
	if #args > 0 then
		return "dekit mprocs " .. table.concat(args, " ")
	end
	return "dekit -C " .. vim.fn.shellescape(cwd) .. " attach"
end

return M
