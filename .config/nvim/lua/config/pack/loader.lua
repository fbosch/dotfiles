local registry = require("config.pack.registry")

local M = {}
local loaded = {}

function M.activate(name)
	if loaded[name] then
		return
	end

	local plugin = assert(registry.get(name), "unknown native plugin: " .. name)
	vim.cmd.packadd(name)
	if plugin.setup ~= nil then
		plugin.setup()
	end
	loaded[name] = true
end

function M.setup()
	for name, plugin in pairs(registry.all()) do
		for _, command in ipairs(plugin.commands or {}) do
			vim.api.nvim_create_autocmd("CmdUndefined", {
				pattern = command,
				callback = function()
					M.activate(name)
				end,
			})
		end

		for _, key in ipairs(plugin.keys or {}) do
			local callback
			if key.expr then
				callback = function()
					M.activate(name)
					return key[2]()
				end
			else
				callback = function()
					M.activate(name)
					key[2]()
				end
			end

			vim.keymap.set(key.mode or "n", key[1], callback, {
				desc = key.desc,
				expr = key.expr == true,
				silent = key.silent,
			})
		end
	end
end

function M.is_loaded(name)
	return loaded[name] == true
end

return M
