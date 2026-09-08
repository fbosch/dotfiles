local ffi = require("ffi")
local bit = require("bit")

pcall(
	ffi.cdef,
	[[
typedef int pid_t;
pid_t fork(void);
int setpgid(pid_t pid, pid_t pgid);
pid_t getpgid(pid_t pid);
int kill(pid_t pid, int sig);
pid_t waitpid(pid_t pid, int *status, int options);
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
	return wait(worker, wnohang)
end

function M.terminate(worker)
	return ffi.C.kill(-worker.pid, sigterm) == 0
end

function M.kill(worker)
	return ffi.C.kill(-worker.pid, sigkill) == 0
end

function M.wait(worker)
	local _, ok = wait(worker, 0)
	return ok
end

return M
