local function install_pi_ask_host(repo_root)
	local package_path = package.path
	local previous = package.loaded["plugins.ai.pi.ask_host"]
	package.path = repo_root
		.. "/.config/nvim/lua/?.lua;"
		.. repo_root
		.. "/.config/nvim/lua/?/init.lua;"
		.. package.path
	package.loaded["plugins.ai.pi.ask_host"] =
		dofile(repo_root .. "/.pi/agent/extensions/neovim/__tests__/fixtures/pi-ask-host.lua")
	return function()
		package.loaded["plugins.ai.pi.ask_host"] = previous
		package.path = package_path
	end
end

return install_pi_ask_host
