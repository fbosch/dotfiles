local paths = require("lib.paths")
local command = require("lib.command")

local M = {}
local apps_file = paths.hypr() .. "/taskbar/apps.json"

local function split_tsv(line)
	local fields = {}
	for field in (line .. "\t"):gmatch("([^\t]*)\t") do
		fields[#fields + 1] = field
	end
	return fields
end

local function load_apps()
	local filter = [[.[] | [.id, .class, .class_pattern, (.tag // ""), (.rule_size // [] | join(" ")), .workspace, (.prewarm | tostring)] | @tsv]]
	local output = command.output(command.line("jq", "-r", filter, apps_file))
	local apps = {}

	for line in output:gmatch("[^\n]+") do
		local fields = split_tsv(line)
		apps[#apps + 1] = {
			id = fields[1],
			class = fields[2],
			class_pattern = fields[3],
			tag = fields[4] ~= "" and fields[4] or nil,
			size = fields[5] ~= "" and fields[5] or nil,
			workspace = fields[6],
			prewarm = fields[7] == "true",
		}
	end

	return apps
end

M.apps = load_apps()

local function launcher_command(app, mode)
	local parts = { paths.hypr() .. "/taskbar/actions.sh", app.id }

	if mode then
		parts[#parts + 1] = mode
	end

	return command.line(table.unpack(parts))
end

function M.autostart_commands()
	local commands = {}

	for _, app in ipairs(M.apps) do
		if app.prewarm then
			commands[#commands + 1] = "uwsm-app -s b -- " .. launcher_command(app, "prewarm")
		end
	end

	return commands
end

function M.apply_rules()
	for _, app in ipairs(M.apps) do
		local rule = {
			float = true,
			no_anim = true,
			no_initial_focus = true,
			workspace = app.workspace .. " silent",
		}

		rule.match = { class = app.class_pattern }

		if app.size then
			rule.size = app.size
		end

		hl.window_rule(rule)
	end
end

return M
