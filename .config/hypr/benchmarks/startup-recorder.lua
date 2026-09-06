local helper = os.getenv("HOME") .. "/.config/hypr/benchmarks/startup-recorder.sh"

local function quote(value)
	return "'" .. value:gsub("'", "'\\''") .. "'"
end

local function timestamp()
	local file = assert(io.open("/proc/uptime", "r"))
	local value = file:read("*l") or ""
	file:close()

	local seconds, fraction = value:match("^(%d+)%.(%d+)")
	assert(seconds and fraction, "invalid /proc/uptime value")
	fraction = fraction:sub(1, 9)
	return seconds .. "." .. fraction .. string.rep("0", 9 - #fraction)
end

local function session_id()
	local value = os.getenv("HYPRLAND_INSTANCE_SIGNATURE") or ""
	if not value:match("^[%w._-]+$") or #value > 200 then
		return nil
	end
	return value
end

local function command(action, marker)
	local session = assert(session_id(), "missing Hyprland session identity")
	local args = { quote(helper), quote(action), quote(session) }
	if marker then
		table.insert(args, quote(marker))
	end
	table.insert(args, quote(timestamp()))
	return table.concat(args, " ")
end

local recorder = {}

function recorder.armed()
	local base = os.getenv("XDG_STATE_HOME")
	if not base or base == "" then
		base = os.getenv("HOME") .. "/.local/state"
	end
	local file = io.open(base .. "/hypr-startup-benchmark/armed", "r")
	if not file then
		return false
	end
	file:close()
	return true
end

function recorder.wrap_ags_command(command_value)
	local session = assert(session_id(), "missing Hyprland session identity")
	return "env HYPR_STARTUP_BENCHMARK_SESSION=" .. quote(session) .. " " .. command_value
end

function recorder.begin()
	return command("begin")
end

function recorder.mark_waybar_layer_mapped()
	return command("mark", "waybar-layer-mapped")
end

return recorder
