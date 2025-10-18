local M = {}
local fn = require("utils.fn")
local sysname = vim.loop.os_uname().sysname

function M.is_windows()
	return sysname == "Windows_NT" or sysname == "Windows"
end

function M.is_macos()
	return sysname == "Darwin"
end

function M.is_linux()
	return sysname == "Linux"
end

function M.is_nixos()
	if not M.is_linux() then
		return false
	 end
	local f = io.open("/etc/os-release", "r")
	if not f then
		return false
	end
	local content = f:read("*a")
	f:close()
	return content:match("ID=nixos") ~= nil
end

function M.is_wsl()
	local is_wsl = false
	if M.is_windows() or M.is_linux() then
		local handle = io.popen("uname -r")
		if handle then
			local kernel_version = handle:read("*a") or ""
			handle:close()
			is_wsl = kernel_version:match("Microsoft") or kernel_version:match("WSL") or false
		end
	end
	return is_wsl
end

function M.open_path_with_app(apps, path)
	for _, app in ipairs(apps) do
		if vim.fn.executable(app) == 1 then
			local command = app .. " " .. vim.fn.shellescape(path)
			vim.fn.jobstart(command, {
				detach = true,
				on_exit = function(_, code, _)
					if code ~= 0 then
						vim.notify("Failed to open " .. path, vim.log.levels.ERROR)
					end
				end,
			})
			return
		end
	end
end

function M.system_open(path)
	if not path then
		return
	end

	if M.is_wsl() then
		if vim.fn.executable("wslview") == 1 then
			vim.fn.jobstart({ "wslview", path }, { detach = true })
			return
		else
			vim.fn.jobstart({ "powershell.exe", "/c", "start", path }, { detach = true })
			return
		end
	elseif M.is_macos() then
		M.open_path_with_app({ "open" }, path)
	elseif M.is_windows() then
		vim.fn.jobstart({ "cmd.exe", "/c", "start", "", path }, { detach = true })
	elseif M.is_linux() then
		M.open_path_with_app({ "xdg-open", "gvfs-open", "gnome-open" }, path)
	else
		vim.notify("Unsupported OS for system_open", vim.log.levels.ERROR)
	end
end

return M
