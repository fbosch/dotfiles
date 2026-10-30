local function install_pi_ask_host(repo_root, path)
	local package_path = package.path
	if repo_root ~= nil then
		package.path = repo_root
			.. "/.config/nvim/lua/?.lua;"
			.. repo_root
			.. "/.config/nvim/lua/?/init.lua;"
			.. package.path
	end
	if path == nil then
		local source = repo_root .. "/.pi/agent/extensions/neovim/__tests__/fixtures/pi-ask-host.lua"
		local output = vim.fn.system({ "nix-store", "--add", source })
		if vim.v.shell_error ~= 0 then
			error("could not materialize immutable Pi Ask test host: " .. output)
		end
		path = vim.trim(output)
	end
	if path:match("^/nix/store/") == nil or vim.uv.fs_realpath(path) ~= path then
		error("Pi Ask test host must be a canonical Nix store path")
	end
	local realpath = vim.uv.fs_realpath
	-- Only replace the activated profile's resource lookup; validate the real immutable fixture.
	vim.uv.fs_realpath = function(value, ...)
		if value == "/run/current-system/sw/share/pi/pi-ask.lua" then
			return path
		end
		return realpath(value, ...)
	end
	return function()
		vim.uv.fs_realpath = realpath
		package.path = package_path
	end, path
end

return install_pi_ask_host
