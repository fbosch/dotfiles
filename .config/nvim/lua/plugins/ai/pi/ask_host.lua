local M = {}

function M.load()
	-- Resolve on each launch so activation can replace the helper without a shell refresh.
	local path = vim.uv.fs_realpath("/run/current-system/sw/share/pi/pi-ask.lua")
	if path == nil then
		return nil, "could not resolve the packaged host from the active system profile"
	end
	if path:match("^/nix/store/") == nil then
		return nil, "packaged host must resolve to an immutable Nix store file"
	end
	local stat = vim.uv.fs_lstat(path)
	if vim.uv.fs_realpath(path) ~= path or stat == nil or stat.type ~= "file" then
		return nil, "packaged host must be a canonical regular file"
	end
	local mode = stat.mode % 512
	if math.floor(mode / 128) % 2 == 1 or math.floor(mode / 16) % 2 == 1 or math.floor(mode / 2) % 2 == 1 then
		return nil, "packaged host must be read-only"
	end
	local ok, factory = pcall(dofile, path)
	if not ok or type(factory) ~= "table" or type(factory.start) ~= "function" then
		return nil, "packaged host factory could not be loaded: " .. tostring(factory)
	end
	return factory
end

return M
