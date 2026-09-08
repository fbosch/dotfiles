local ffi = require("ffi")
local bit = require("bit")

pcall(
	ffi.cdef,
	[[
int fork(void);
int setpgid(int pid, int pgid);
int getpgid(int pid);
int kill(int pid, int sig);
int waitpid(int pid, int *status, int options);
]]
)

local M = {}

local wnohang = 1
local sigterm = 15
local sigkill = 9

local function succeeded(status)
	local value = tonumber(status[0])
	return bit.band(value, 0x7f) == 0 and bit.rshift(value, 8) == 0
end

local function wait(worker, options)
	local status = ffi.new("int[1]")
	local result = ffi.C.waitpid(worker.pid, status, options)
	if result == 0 then
		return nil
	end
	if result ~= worker.pid then
		return true, false
	end
	return true, succeeded(status)
end

function M.start(label, run, metadata)
	local pid = ffi.C.fork()
	if pid < 0 then
		return nil, "failed to fork " .. label .. " worker"
	end

	if pid == 0 then
		if ffi.C.setpgid(0, 0) ~= 0 then
			os.exit(1)
		end
		local ok, result = xpcall(run, debug.traceback)
		if not ok then
			io.stderr:write("waybar-monitor: ", label, " worker failed: ", tostring(result), "\n")
		end
		os.exit(ok and result == true and 0 or 1)
	end

	pid = tonumber(pid)
	if ffi.C.setpgid(pid, pid) ~= 0 and tonumber(ffi.C.getpgid(pid)) ~= pid then
		ffi.C.kill(pid, sigterm)
		local worker = { pid = pid, label = label, metadata = metadata or {} }
		wait(worker, 0)
		return nil, "failed to own " .. label .. " worker process group"
	end

	return { pid = pid, label = label, metadata = metadata or {} }
end

function M.reap(worker)
	local finished, ok = wait(worker, wnohang)
	if finished then
		-- A command can outlive the Lua leader; completion retires the whole owned group.
		ffi.C.kill(-worker.pid, sigkill)
	end
	return finished, ok
end

function M.terminate(worker)
	return ffi.C.kill(-worker.pid, sigterm) == 0
end

function M.kill(worker)
	return ffi.C.kill(-worker.pid, sigkill) == 0
end

function M.wait(worker)
	local _, ok = wait(worker, 0)
	ffi.C.kill(-worker.pid, sigkill)
	return ok
end

return M
