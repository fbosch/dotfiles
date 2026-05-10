local paths = require("lib.paths")
local command = require("lib.command")

local M = {}

M.apps = {
	{
		id = "calendar",
		class = "org.gnome.Calendar",
		class_pattern = "^(org\\.gnome\\.Calendar)$",
		command = "gnome-calendar",
		tag = "taskbar_calendar",
		workspace = "special:taskbar-calendar",
		prewarm = true,
	},
	{
		id = "missioncenter",
		class = "io.missioncenter.MissionCenter",
		class_pattern = "^(io\\.missioncenter\\.MissionCenter)$",
		command = "missioncenter",
		size = "754 759",
		tag = "taskbar_missioncenter",
		workspace = "special:taskbar-missioncenter",
		prewarm = false,
	},
	{
		id = "btop-cpu",
		class = "btop_cpu_terminal",
		class_pattern = "^(btop_cpu_terminal)$",
		size = "920 620",
		workspace = "special:taskbar-btop-cpu",
		prewarm = false,
	},
	{
		id = "btop-mem",
		class = "btop_mem_terminal",
		class_pattern = "^(btop_mem_terminal)$",
		size = "920 620",
		workspace = "special:taskbar-btop-mem",
		prewarm = false,
	},
	{
		id = "nvitop",
		class = "nvitop_terminal",
		class_pattern = "^(nvitop_terminal)$",
		size = "900 655",
		workspace = "special:taskbar-nvitop",
		prewarm = false,
	},
	{
		id = "s-tui",
		class = "s_tui_terminal",
		class_pattern = "^(s_tui_terminal)$",
		size = "1200 760",
		workspace = "special:taskbar-s-tui",
		prewarm = false,
	},
	{
		id = "wiremix",
		class = "wiremix_terminal",
		class_pattern = "^(wiremix_terminal)$",
		size = "725 500",
		workspace = "special:taskbar-wiremix",
		prewarm = false,
	},
}

local function launcher_command(app, mode)
	local parts = { paths.script("taskbar-app.sh"), app.id }

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

		if app.tag then
			rule.match = { tag = app.tag .. "*" }
		else
			rule.match = { class = app.class_pattern }
		end

		if app.size then
			rule.size = app.size
		end

		hl.window_rule(rule)
	end
end

return M
