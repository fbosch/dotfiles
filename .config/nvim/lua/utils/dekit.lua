local M = {}

local generation = 0

local function status(entry)
	if not entry.task then
		return "not started"
	end
	local state = entry.task.state == "ready" and "running" or entry.task.state
	if entry.task.exit_code ~= nil then
		state = state .. " (" .. entry.task.exit_code .. ")"
	end
	return state
end

function M.pick(root, on_attach)
	generation = generation + 1
	local current = generation

	local function request(params, callback)
		local command = { "bun", vim.fn.expand("~/.pi/agent/extensions/dekit/project-cli.ts"), root }
		if require("utils.project").has_file(root, ".envrc") then
			command = vim.list_extend({ "direnv", "exec", root }, command)
		end
		local ok, err = pcall(vim.system, command, {
			cwd = root,
			text = true,
			stdin = vim.json.encode(params),
			timeout = 30000,
		}, function(result)
			vim.schedule(function()
				if current ~= generation then
					return
				end
				if result.code ~= 0 then
					local detail = vim.trim(result.stderr or "")
					vim.notify(
						"Dekit "
							.. params.action
							.. " failed ("
							.. result.code
							.. ")"
							.. (detail ~= "" and ": " .. detail:sub(1, 2000) or ""),
						vim.log.levels.ERROR
					)
					return
				end
				local decoded, data = pcall(vim.json.decode, result.stdout)
				if
					not decoded
					or type(data) ~= "table"
					or type(data.project) ~= "string"
					or (params.action == "list" and type(data.entries) ~= "table")
					or (params.action ~= "list" and type(data.task) ~= "string")
				then
					vim.notify("Dekit returned an invalid response", vim.log.levels.ERROR)
					return
				end
				callback(data)
			end)
		end)
		if not ok then
			vim.notify("Could not open Dekit: " .. tostring(err), vim.log.levels.ERROR)
		end
	end

	local browse
	local function act(params)
		request(params, function(result)
			if params.action == "stop" then
				browse()
			else
				on_attach(result.project, result.task)
			end
		end)
	end

	local function start(entry, with_arguments)
		if with_arguments or #entry.requiredParameters > 0 then
			local names = table.concat(entry.requiredParameters, ", ")
			local prompt = entry.name .. " arguments" .. (names ~= "" and " (" .. names .. ")" or "") .. ": "
			vim.ui.input({ prompt = prompt }, function(input)
				if input ~= nil and current == generation then
					act({ action = "start", script = entry.script, input = input })
				end
			end)
		else
			act({ action = "start", script = entry.script, input = "" })
		end
	end

	browse = function()
		request({ action = "list" }, function(result)
			root = result.project
			local entries = { { name = "Open task console", action = "console" } }
			vim.list_extend(entries, result.entries or {})
			table.insert(entries, { name = "Refresh", action = "refresh" })
			vim.ui.select(entries, {
				prompt = "Project scripts and tasks",
				format_item = function(entry)
					if entry.action then
						return entry.name
					end
					return entry.name .. " [" .. status(entry) .. "]"
				end,
			}, function(entry)
				if entry == nil or current ~= generation then
					return
				end
				if entry.action == "console" then
					on_attach(root)
					return
				elseif entry.action == "refresh" then
					browse()
					return
				end
				local actions = {}
				if entry.task then
					actions = {
						{ name = "View output", action = "view" },
						{ name = "Restart", action = "restart" },
						{ name = "Stop", action = "stop" },
					}
				else
					table.insert(actions, { name = "Start", action = "start" })
				end
				if entry.script then
					table.insert(actions, { name = "Start with arguments…", action = "arguments" })
				end
				vim.ui.select(actions, {
					prompt = entry.name .. " [" .. status(entry) .. "]",
					format_item = function(item)
						return item.name
					end,
				}, function(action)
					if action == nil or current ~= generation then
						return
					end
					if action.action == "start" or action.action == "arguments" then
						start(entry, action.action == "arguments")
					else
						act({ action = action.action, task = entry.task.path, id = entry.task.id })
					end
				end)
			end)
		end)
	end

	browse()
end

return M
