local function immutable_pi_ask_host(repo_root)
	local source = repo_root .. "/.pi/agent/extensions/neovim/__tests__/fixtures/pi-ask-host.lua"
	local output = vim.fn.system({ "nix-store", "--add", source })
	if vim.v.shell_error ~= 0 then
		error("could not materialize immutable Pi Ask test host: " .. output)
	end
	local path = vim.trim(output)
	if path:match("^/nix/store/") == nil or vim.uv.fs_realpath(path) ~= path then
		error("nix-store returned a noncanonical Pi Ask test host path")
	end
	return path
end

return immutable_pi_ask_host
