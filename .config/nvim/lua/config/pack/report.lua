local M = {}

local function package_count(count)
	return count == 1 and "package" or "packages"
end

local function present_verb(count)
	return count == 1 and "is" or "are"
end

local function remaining_verb(count)
	return count == 1 and "remains" or "remain"
end

local function write_result(message)
	io.stdout:write(message, "\n")
	io.stdout:flush()
end

function M.run()
	local inventory_module = require("config.pack.inventory")
	inventory_module.register(require("config.pack.discovery").load())
	local inventory = inventory_module.current()
	local statuses = require("config.pack.disabled_sync").inspect_disabled_packages(inventory.disabled_names)

	if #statuses == 0 then
		write_result("Success  No Neovim packages are disabled in this environment.")
		return
	end

	local installed_count = 0
	for _, status in ipairs(statuses) do
		local label = status.installed and "Present" or "Absent "
		write_result(("%s  %s  %s"):format(label, status.name, status.path))
		if status.installed then
			installed_count = installed_count + 1
		end
	end

	if installed_count > 0 then
		io.stderr:write(
			("Error    %d disabled Neovim %s %s installed."):format(
				installed_count,
				package_count(installed_count),
				remaining_verb(installed_count)
			),
			"\n"
		)
		io.stderr:flush()
		vim.cmd("cquit 1")
		return
	end

	write_result(
		("Success  %d disabled Neovim %s %s absent."):format(
			#statuses,
			package_count(#statuses),
			present_verb(#statuses)
		)
	)
end

return M
