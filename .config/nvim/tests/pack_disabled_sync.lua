local repo_root = assert(vim.env.REPO_ROOT)
local disabled_sync = dofile(repo_root .. "/.config/nvim/lua/config/pack/disabled_sync.lua")
local lock_path = vim.fs.joinpath(vim.fn.stdpath("config"), "nvim-pack-lock.json")
local package_root = vim.fs.joinpath(vim.fn.stdpath("data"), "site", "pack", "core", "opt")
local real_fs_rm = vim.fs.rm
local real_pack_add = vim.pack.add

local function package_path(name)
	return vim.fs.joinpath(package_root, name)
end

local function marker_path(name)
	return vim.fs.joinpath(package_path(name), ".nvim-pack-disabled")
end

local function spec(name)
	return {
		name = name,
		src = "https://invalid.example/" .. name .. ".git",
	}
end

local function write_lock(names)
	local plugins = {}
	for _, name in ipairs(names) do
		plugins[name] = {
			rev = "0000000000000000000000000000000000000000",
			src = "https://invalid.example/" .. name .. ".git",
		}
	end
	vim.fn.mkdir(vim.fn.stdpath("config"), "p")
	vim.fn.writefile({ vim.json.encode({ plugins = plugins }) }, lock_path)
end

do
	local absent_name = "audit-absent.nvim"
	local installed_name = "audit-installed.nvim"
	vim.fn.mkdir(package_path(installed_name), "p")

	local statuses = disabled_sync.inspect_disabled_packages({ installed_name, absent_name })
	assert(#statuses == 2, "disabled package inspection omitted a package")
	assert(statuses[1].name == absent_name, "disabled package inspection was not sorted")
	assert(statuses[1].path == package_path(absent_name), "absent package path was incorrect")
	assert(statuses[1].installed == false, "absent package was reported as installed")
	assert(statuses[2].name == installed_name, "installed package inspection was not sorted")
	assert(statuses[2].path == package_path(installed_name), "installed package path was incorrect")
	assert(statuses[2].installed == true, "installed package was reported as absent")
	assert(vim.uv.fs_lstat(package_path(installed_name)) ~= nil, "package inspection mutated installed state")

	real_fs_rm(package_path(installed_name), { recursive = true, force = true })
end

do
	local name = "lock-only-example.nvim"
	write_lock({ name })
	disabled_sync.synchronize({ specs = {}, disabled_names = { name } })

	assert(vim.uv.fs_lstat(package_path(name)) == nil, "disabled package sentinel remained after synchronization")
	vim.pack.update({}, { force = true, offline = true })
	local lock = vim.json.decode(table.concat(vim.fn.readfile(lock_path), "\n"))
	assert(type(lock.plugins[name]) == "table", "disabled package lock entry was removed")
end

do
	local disabled_name = "absent-lock-example.nvim"
	local enabled_name = "enabled-again-example.nvim"
	write_lock({})
	vim.fn.mkdir(package_path(disabled_name), "p")
	vim.fn.writefile({ "installed" }, vim.fs.joinpath(package_path(disabled_name), "plugin.lua"))
	vim.fn.mkdir(package_path(enabled_name), "p")
	vim.fn.writefile({}, marker_path(enabled_name))

	local calls = 0
	vim.pack.add = function(specs, options)
		calls = calls + 1
		assert(#specs == 1 and specs[1].name == enabled_name, "native synchronization received unexpected specs")
		assert(options.confirm == true and type(options.load) == "function", "native synchronization options changed")
		assert(vim.uv.fs_lstat(package_path(disabled_name)) == nil, "disabled package remained before synchronization")
		assert(
			vim.uv.fs_lstat(package_path(enabled_name)) == nil,
			"stale enabled sentinel remained before synchronization"
		)
	end
	disabled_sync.synchronize({
		specs = { spec(enabled_name) },
		disabled_names = { disabled_name },
	})
	vim.pack.add = real_pack_add

	assert(calls == 1, "native synchronization was not called exactly once")
end

do
	local name = "active-example.nvim"
	write_lock({})
	vim.fn.mkdir(package_path(name), "p")
	local runtimepath = vim.opt.runtimepath:get()
	vim.opt.runtimepath:append(package_path(name))
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = { name } })
	vim.pack.add = real_pack_add
	vim.opt.runtimepath = runtimepath

	assert(ok == false, "active disabled package was accepted")
	assert(calls == 0, "synchronization ran for an active disabled package")
	assert(vim.uv.fs_lstat(package_path(name)) ~= nil, "active disabled package was mutated")
	assert(
		tostring(err):find("native disabled plugin is active: " .. name, 1, true) ~= nil,
		"unexpected active disabled package error: " .. tostring(err)
	)
	real_fs_rm(package_path(name), { recursive = true, force = true })
end

do
	local name = "malformed-lock-example.nvim"
	vim.fn.writefile({ "{" }, lock_path)
	vim.fn.mkdir(package_path(name), "p")
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = { name } })
	vim.pack.add = real_pack_add

	assert(ok == false, "malformed lock was accepted")
	assert(calls == 0, "synchronization ran with a malformed lock")
	assert(vim.uv.fs_lstat(package_path(name)) ~= nil, "package state changed before lock validation")
	assert(
		tostring(err):find("native package lock decode failed", 1, true) ~= nil,
		"unexpected malformed lock error: " .. tostring(err)
	)
	real_fs_rm(package_path(name), { recursive = true, force = true })
end

do
	real_fs_rm(lock_path, { recursive = true, force = true })
	vim.fn.mkdir(lock_path, "p")
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = {} })
	vim.pack.add = real_pack_add

	assert(ok == false, "unreadable lock path was accepted")
	assert(calls == 0, "synchronization ran with an unreadable lock path")
	assert(
		tostring(err):find("native package lock read failed", 1, true) ~= nil,
		"unexpected unreadable lock error: " .. tostring(err)
	)
	real_fs_rm(lock_path, { recursive = true, force = true })
end

do
	local fs_lstat = vim.uv.fs_lstat
	local calls = 0
	vim.uv.fs_lstat = function(path)
		if path == lock_path then
			return nil, "EACCES: permission denied: " .. path, "EACCES"
		end
		return fs_lstat(path)
	end
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = {} })
	vim.uv.fs_lstat = fs_lstat
	vim.pack.add = real_pack_add

	assert(ok == false, "lock stat failure was treated as a missing lock")
	assert(calls == 0, "synchronization ran after lock stat failed")
	assert(
		tostring(err):find("native package lock stat failed", 1, true) ~= nil,
		"unexpected lock stat failure: " .. tostring(err)
	)
end

do
	local name = "malformed-entry-example.nvim"
	vim.fn.writefile({
		vim.json.encode({ plugins = { [name] = { rev = "abc" } } }),
	}, lock_path)
	vim.fn.mkdir(package_path(name), "p")
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = { name } })
	vim.pack.add = real_pack_add

	assert(ok == false, "malformed lock entry was accepted")
	assert(calls == 0, "synchronization ran with a malformed lock entry")
	assert(vim.uv.fs_lstat(package_path(name)) ~= nil, "package state changed before lock entry validation")
	assert(
		tostring(err):find("native package lock source is required: " .. name, 1, true) ~= nil,
		"unexpected malformed lock entry error: " .. tostring(err)
	)
	real_fs_rm(package_path(name), { recursive = true, force = true })
end

do
	local victim = vim.fs.joinpath(vim.fs.dirname(package_root), "victim")
	vim.fn.mkdir(victim, "p")
	vim.fn.writefile({
		vim.json.encode({
			plugins = {
				["../victim"] = { rev = "abc", src = "https://invalid.example/victim.git" },
			},
		}),
	}, lock_path)
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = {} })
	vim.pack.add = real_pack_add

	assert(ok == false, "unsafe lock package name was accepted")
	assert(calls == 0, "synchronization ran with an unsafe lock package name")
	assert(vim.uv.fs_lstat(victim) ~= nil, "unsafe lock package name escaped the package root")
	assert(
		tostring(err):find("native package lock name must be one path segment", 1, true) ~= nil,
		"unexpected unsafe lock package name error: " .. tostring(err)
	)
	real_fs_rm(victim, { recursive = true, force = true })
end

do
	local name = "overlap-example.nvim"
	local ok, err = pcall(disabled_sync.synchronize, {
		specs = { spec(name) },
		disabled_names = { name },
	})
	assert(ok == false, "enabled and disabled package overlap was accepted")
	assert(
		tostring(err):find("native package cannot be enabled and disabled: " .. name, 1, true) ~= nil,
		"unexpected package overlap error: " .. tostring(err)
	)
end

do
	local victim = vim.fs.joinpath(vim.fs.dirname(package_root), "input-victim")
	vim.fn.mkdir(victim, "p")
	local ok, err = pcall(disabled_sync.synchronize, {
		specs = {},
		disabled_names = { "../input-victim" },
	})
	assert(ok == false, "unsafe disabled package name was accepted")
	assert(vim.uv.fs_lstat(victim) ~= nil, "unsafe disabled package name escaped the package root")
	assert(
		tostring(err):find("native disabled package name must be one path segment", 1, true) ~= nil,
		"unexpected unsafe disabled package name error: " .. tostring(err)
	)
	real_fs_rm(victim, { recursive = true, force = true })
end

for _, name in ipairs({ "\0suffix", ".\0suffix", "..\0suffix" }) do
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = { name } })
	vim.pack.add = real_pack_add

	assert(ok == false, "NUL-containing disabled package name was accepted")
	assert(calls == 0, "synchronization ran with a NUL-containing disabled package name")
	assert(
		tostring(err):find("native disabled package name must be one path segment", 1, true) ~= nil,
		"unexpected NUL-containing disabled package name error: " .. tostring(err)
	)
end

do
	vim.fn.writefile({
		vim.json.encode({
			plugins = {
				["\0suffix"] = { rev = "abc", src = "https://invalid.example/nul.git" },
			},
		}),
	}, lock_path)
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = {} })
	vim.pack.add = real_pack_add

	assert(ok == false, "NUL-containing lock package name was accepted")
	assert(calls == 0, "synchronization ran with a NUL-containing lock package name")
	assert(
		tostring(err):find("native package lock name must be one path segment", 1, true) ~= nil,
		"unexpected NUL-containing lock package name error: " .. tostring(err)
	)
end

do
	local name = "invalid-version-example.nvim"
	write_lock({})
	vim.fn.mkdir(package_path(name), "p")
	vim.fn.writefile({}, marker_path(name))
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local invalid_spec = spec(name)
	invalid_spec.version = 42
	local ok, err = pcall(disabled_sync.synchronize, { specs = { invalid_spec }, disabled_names = {} })
	vim.pack.add = real_pack_add

	assert(ok == false, "invalid package version was accepted")
	assert(calls == 0, "synchronization ran with an invalid package version")
	assert(vim.uv.fs_lstat(marker_path(name)) ~= nil, "package state changed before spec validation")
	assert(
		tostring(err):find("native package spec version is invalid", 1, true) ~= nil,
		"unexpected invalid package version error: " .. tostring(err)
	)
	real_fs_rm(package_path(name), { recursive = true, force = true })
end

do
	local name = "invalid-range-example.nvim"
	write_lock({})
	vim.fn.mkdir(package_path(name), "p")
	vim.fn.writefile({}, marker_path(name))
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	local invalid_spec = spec(name)
	invalid_spec.version = {
		has = function()
			error("invalid range")
		end,
	}
	local ok, err = pcall(disabled_sync.synchronize, { specs = { invalid_spec }, disabled_names = {} })
	vim.pack.add = real_pack_add

	assert(ok == false, "invalid version range was accepted")
	assert(calls == 0, "synchronization ran with an invalid version range")
	assert(vim.uv.fs_lstat(marker_path(name)) ~= nil, "package state changed before version range validation")
	assert(
		tostring(err):find("native package spec version is invalid", 1, true) ~= nil,
		"unexpected invalid version range error: " .. tostring(err)
	)
	real_fs_rm(package_path(name), { recursive = true, force = true })
end

do
	local name = "retained-lock-example.nvim"
	write_lock({ name })
	vim.fn.mkdir(package_path(name), "p")
	local calls = 0
	vim.pack.add = function()
		calls = calls + 1
	end
	disabled_sync.synchronize({ specs = {}, disabled_names = {} })
	vim.pack.add = real_pack_add

	assert(calls == 1, "valid retained lock entry blocked synchronization")
	assert(vim.uv.fs_lstat(package_path(name)) ~= nil, "retained lock package was reconciled without input")
	real_fs_rm(package_path(name), { recursive = true, force = true })
end

do
	local first = "prepare-first-example.nvim"
	local second = "prepare-second-example.nvim"
	write_lock({ first, second })
	local mkdir = vim.fn.mkdir
	local calls = 0
	vim.fn.mkdir = function(path, flags)
		if path == package_path(second) then
			error("mkdir exploded")
		end
		return mkdir(path, flags)
	end
	vim.pack.add = function()
		calls = calls + 1
	end
	local ok, err = pcall(disabled_sync.synchronize, {
		specs = {},
		disabled_names = { first, second },
	})
	vim.fn.mkdir = mkdir
	vim.pack.add = real_pack_add

	assert(ok == false, "preparation failure was ignored")
	assert(calls == 0, "synchronization ran after preparation failed")
	assert(vim.uv.fs_lstat(package_path(first)) == nil, "earlier sentinel remained after preparation failed")
	assert(vim.uv.fs_lstat(package_path(second)) == nil, "partial sentinel remained after preparation failed")
	assert(
		tostring(err):find("native package preparation failed", 1, true) ~= nil
			and tostring(err):find("mkdir exploded", 1, true) ~= nil,
		"unexpected preparation failure: " .. tostring(err)
	)
end

do
	local first = "prepare-cleanup-first.nvim"
	local second = "prepare-cleanup-second.nvim"
	write_lock({ first, second })
	local mkdir = vim.fn.mkdir
	local failed_cleanup = false
	vim.fn.mkdir = function(path, flags)
		if path == package_path(second) then
			error("preparation exploded")
		end
		return mkdir(path, flags)
	end
	vim.fs.rm = function(path, options)
		if path == package_path(first) and vim.uv.fs_lstat(marker_path(first)) ~= nil and failed_cleanup == false then
			failed_cleanup = true
			error("preparation cleanup exploded")
		end
		return real_fs_rm(path, options)
	end
	local ok, err = pcall(disabled_sync.synchronize, {
		specs = {},
		disabled_names = { first, second },
	})
	vim.fn.mkdir = mkdir
	vim.fs.rm = real_fs_rm

	local message = tostring(err)
	local preparation_pos = message:find("preparation exploded", 1, true)
	local cleanup_pos = message:find("preparation cleanup exploded", 1, true)
	assert(ok == false, "preparation and cleanup failures were ignored")
	assert(preparation_pos ~= nil and cleanup_pos ~= nil, "preparation dual failure omitted a cause: " .. message)
	assert(preparation_pos < cleanup_pos, "cleanup failure replaced the preparation failure")
	assert(vim.uv.fs_lstat(package_path(second)) == nil, "cleanup skipped the partial second sentinel")
	real_fs_rm(package_path(first), { recursive = true, force = true })
end

do
	local first = "cleanup-first-example.nvim"
	local second = "cleanup-second-example.nvim"
	write_lock({ first, second })
	local failed_cleanup = false
	vim.fs.rm = function(path, options)
		if path == package_path(first) and vim.uv.fs_lstat(marker_path(first)) ~= nil and failed_cleanup == false then
			failed_cleanup = true
			error("cleanup exploded")
		end
		return real_fs_rm(path, options)
	end
	vim.pack.add = function()
		error("synchronization exploded")
	end
	local ok, err = pcall(disabled_sync.synchronize, {
		specs = {},
		disabled_names = { first, second },
	})
	vim.fs.rm = real_fs_rm
	vim.pack.add = real_pack_add

	local message = tostring(err)
	local synchronization_pos = message:find("synchronization exploded", 1, true)
	local cleanup_pos = message:find("cleanup exploded", 1, true)
	assert(ok == false, "synchronization and cleanup failures were ignored")
	assert(synchronization_pos ~= nil and cleanup_pos ~= nil, "dual failure omitted a cause: " .. message)
	assert(synchronization_pos < cleanup_pos, "cleanup failure replaced the synchronization failure")
	assert(vim.uv.fs_lstat(package_path(first)) ~= nil, "forced cleanup failure did not leave its sentinel")
	assert(vim.uv.fs_lstat(package_path(second)) == nil, "cleanup stopped after the first failure")
	real_fs_rm(package_path(first), { recursive = true, force = true })
end

do
	local name = "cleanup-only-example.nvim"
	write_lock({ name })
	vim.fs.rm = function(path, options)
		if path == package_path(name) and vim.uv.fs_lstat(marker_path(name)) ~= nil then
			error("cleanup-only exploded")
		end
		return real_fs_rm(path, options)
	end
	vim.pack.add = function() end
	local ok, err = pcall(disabled_sync.synchronize, { specs = {}, disabled_names = { name } })
	vim.fs.rm = real_fs_rm
	vim.pack.add = real_pack_add

	assert(ok == false, "cleanup-only failure was ignored")
	assert(
		tostring(err):find("native disabled package cleanup failed", 1, true) ~= nil
			and tostring(err):find("cleanup-only exploded", 1, true) ~= nil,
		"unexpected cleanup-only failure: " .. tostring(err)
	)
	real_fs_rm(package_path(name), { recursive = true, force = true })
end
