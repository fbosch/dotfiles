local repo_root = assert(vim.env.REPO_ROOT)
local restore_profile, immutable_host = dofile(repo_root .. "/.config/nvim/tests/pi_ask_host.lua")(repo_root)
local loader = require("plugins.ai.pi.ask_host")
local realpath, lstat = vim.uv.fs_realpath, vim.uv.fs_lstat
local selected_host
vim.uv.fs_realpath = function(path, ...)
	if path == "/run/current-system/sw/share/pi/pi-ask.lua" then
		return selected_host
	end
	return realpath(path, ...)
end

local function rejects(message)
	local factory, err = loader.load()
	assert(factory == nil, "invalid packaged host was accepted")
	assert(type(err) == "string" and err:find(message, 1, true), tostring(err))
end

rejects("could not resolve")
selected_host = immutable_host
assert(type(assert(loader.load()).start) == "function", "host lookup did not recover after activation")
selected_host = nil
rejects("could not resolve")
selected_host = immutable_host
assert(loader.load(), "host lookup cached a failed activation")

local writable_host = vim.fn.tempname() .. ".lua"
vim.fn.writefile({ 'error("mutable host must not be executed")' }, writable_host)
selected_host = writable_host
rejects("immutable Nix store file")
vim.fn.delete(writable_host)

selected_host = immutable_host
for _, write_bit in ipairs({ 128, 16, 2 }) do
	vim.uv.fs_lstat = function(path, ...)
		local stat = lstat(path, ...)
		if path == immutable_host then
			stat.mode = bit.bor(stat.mode, write_bit)
		end
		return stat
	end
	rejects("read-only")
end
vim.uv.fs_lstat = function(path, ...)
	local stat = lstat(path, ...)
	if path == immutable_host then
		stat.type = "directory"
	end
	return stat
end
rejects("canonical regular file")
vim.uv.fs_lstat = lstat

local loadfile = dofile
_G.dofile = function(path)
	assert(path == immutable_host)
	return { start = false }
end
rejects("factory could not be loaded")
_G.dofile = loadfile
assert(loader.load(), "valid immutable host did not recover after a rejected factory")

vim.uv.fs_realpath = realpath
restore_profile()
