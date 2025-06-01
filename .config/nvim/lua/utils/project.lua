local fn = require("utils.fn")

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
	lua = function(dir, pkg)
		return M.has_file(dir, "init.lua")
	end,
	nextjs = function(dir, pkg)
		return M.has_dep(pkg, "next")
	end,
	react = function(dir, pkg)
		return M.has_dep(pkg, "react")
	end,
	astro = function(dir, pkg)
		return M.has_dep(pkg, "astro")
	end,
	bun = function(dir, pkg)
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

function M.find_mprocs_yaml()
	local root_bare = vim.fs.root(vim.fn.cwd(), { ".bare" }) -- support for worktrees, placing mprocs.lua near .bare symlink
	local root_other = vim.fs.root(vim.fn.getcwd(), { "package.json", ".git", "Cargo.toml" })
	local root = root_bare or root_other
	if not root then
		return nil
	end
	for _, fname in ipairs({ "mprocs.yaml", "mprocs.yml" }) do
		local candidate = root .. "/" .. fname
		if vim.loop.fs_stat(candidate) then
			return candidate
		end
	end
end

function M.resolve_mprocs_args()
	local project_mprocs_yaml = M.find_mprocs_yaml()

	if project_mprocs_yaml then
		return string.format("--config %s", project_mprocs_yaml)
	end

	local project_types = M.get_project_types()

	return fn.classify(project_types, {
		{
			{ "typescript", "javascript", "react" },
			"--npm",
		},
	}) or ""
end

return M
