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
	local root_other = vim.fs.root(vim.fn.getcwd(), {
		"dekit.yaml",
		"devenv.nix",
		"package.json",
		".git",
		"Cargo.toml",
		"justfile",
		"Justfile",
		".justfile",
	})

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

local function direnv_is_loaded(cwd)
	local active = vim.env.DIRENV_DIR
	if type(active) ~= "string" or active:sub(1, 1) ~= "-" then
		return false
	end
	local root = vim.uv.fs_realpath(cwd)
	if root == nil or vim.uv.fs_realpath(active:sub(2)) ~= root then
		return false
	end

	-- Direnv stamps directory metadata even for blocked loads; verify approval without evaluating .envrc.
	local ok, result = pcall(function()
		return vim.system({ "direnv", "status", "--json" }, { cwd = cwd, text = true }):wait(1000)
	end)
	if not ok or type(result) ~= "table" or result.code ~= 0 then
		return false
	end
	local decoded, status = pcall(vim.json.decode, result.stdout)
	if not decoded or type(status) ~= "table" or type(status.state) ~= "table" then
		return false
	end

	local envrc = vim.uv.fs_realpath(vim.fs.joinpath(cwd, ".envrc"))
	if envrc == nil then
		return false
	end
	local function matches(rc)
		return type(rc) == "table"
			and rc.allowed == 0
			and type(rc.path) == "string"
			and vim.uv.fs_realpath(rc.path) == envrc
	end
	return matches(status.state.loadedRC) and matches(status.state.foundRC)
end

function M.resolve_dekit_command(cwd)
	local importer = vim.fn.expand("~/.pi/agent/extensions/dekit/import-scripts.ts")
	local root = vim.fn.shellescape(cwd)
	local cmd = "bun " .. vim.fn.shellescape(importer) .. " " .. root .. " && exec dekit -C " .. root .. " attach"
	if M.has_file(cwd, ".envrc") and not direnv_is_loaded(cwd) then
		return string.format("direnv exec %s dash -c %s", root, vim.fn.shellescape(cmd))
	end
	return cmd
end

return M
