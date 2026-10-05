local json = require("lib.json")

local M = {}

local function identity(matcher, pattern)
	return matcher .. "\0" .. pattern
end

function M.publish(path, selectors, native_state)
	local entries = {}
	for _, selector in ipairs(selectors) do
		entries[#entries + 1] = { matcher = selector.matcher, pattern = selector.pattern }
	end
	local content = json.encode({ version = 1, selectors = entries, native_state = native_state == true })
	assert(#content <= 16384, "persistent-position readiness policy is too large")
	local temporary = path .. ".tmp"
	local file = assert(io.open(temporary, "w"))
	local ok, err = file:write(content)
	local closed, close_err = file:close()
	if not ok or not closed then
		os.remove(temporary)
		error(err or close_err or "readiness write failed")
	end
	local renamed, rename_err = os.rename(temporary, path)
	if not renamed then
		os.remove(temporary)
		error(rename_err or "readiness replacement failed")
	end
end

function M.read(path)
	local file = io.open(path, "r")
	if not file then
		return nil
	end
	local content = file:read(16385)
	file:close()
	if not content or #content > 16384 then
		return nil
	end
	local ok, payload = pcall(json.decode, content)
	if not ok or type(payload) ~= "table" or payload.version ~= 1 or type(payload.selectors) ~= "table" then
		return nil
	end
	local owned = {}
	local count = 0
	for index, selector in pairs(payload.selectors) do
		count = count + 1
		if
			type(index) ~= "number"
			or index < 1
			or index % 1 ~= 0
			or type(selector) ~= "table"
			or type(selector.matcher) ~= "string"
			or type(selector.pattern) ~= "string"
			or #selector.matcher == 0
			or #selector.matcher > 64
			or #selector.pattern == 0
			or #selector.pattern > 512
		then
			return nil
		end
		owned[identity(selector.matcher, selector.pattern)] = true
	end
	if count == 0 or count > 256 or count ~= #payload.selectors then
		return nil
	end
	return owned
end

-- A v2 owner replaces the daemon; this is session state, not persistent configuration.
function M.native_state(path)
	local file = io.open(path, "r")
	if not file then
		return false
	end
	local content = file:read(16385)
	file:close()
	if not content or #content > 16384 then
		return false
	end
	local ok, payload = pcall(json.decode, content)
	return ok and type(payload) == "table" and payload.version == 1 and payload.native_state == true
end

return M
