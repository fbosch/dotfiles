local M = {}

local function encode(value)
	return tostring(value):gsub("([^%w_.-])", function(char)
		return string.format("%%%02X", string.byte(char))
	end)
end

local function decode(value)
	return tostring(value):gsub("%%(%x%x)", function(hex)
		return string.char(tonumber(hex, 16))
	end)
end

local function serialize_numbers(values)
	local serialized = {}
	for index = 1, #values do
		serialized[index] = tostring(values[index])
	end

	return table.concat(serialized, ",")
end

local function parse_numbers(value)
	local numbers = {}
	for item in tostring(value):gmatch("[^,]+") do
		numbers[#numbers + 1] = tonumber(item)
	end

	return numbers
end

local function serialize_strings(values)
	local serialized = {}
	for index = 1, #values do
		serialized[index] = encode(values[index])
	end

	return table.concat(serialized, ",")
end

local function parse_strings(value)
	local strings = {}
	for item in tostring(value):gmatch("[^,]+") do
		strings[#strings + 1] = decode(item)
	end

	return strings
end

function M.state_file(disable_global, override_global, filename)
	if rawget(_G, disable_global) then
		return nil
	end

	local override = rawget(_G, override_global)
	if override then
		return override
	end

	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or runtime_dir == "" or not signature or signature == "" then
		return nil
	end

	return runtime_dir .. "/hypr/" .. signature .. "/" .. filename
end

function M.workspace_key(targets, fallback)
	for index = 1, #targets do
		local window = targets[index].window
		local workspace = window and window.workspace
		if workspace then
			return tostring(workspace.id or workspace.name)
		end
	end

	return fallback
end

function M.save(path, ratio_tables, order_by_key)
	if not path then
		return
	end

	local handle = io.open(path, "w")
	if not handle then
		return
	end

	for index = 1, #ratio_tables do
		local ratio_table = ratio_tables[index]
		for key, ratios in pairs(ratio_table.values) do
			handle:write(ratio_table.kind, "\t", encode(key), "\t", #ratios, "\t", serialize_numbers(ratios), "\n")
		end
	end

	for key, order in pairs(order_by_key) do
		handle:write("order\t", encode(key), "\t", #order, "\t", serialize_strings(order), "\n")
	end

	handle:close()
end

function M.load(path, ratio_tables_by_kind, order_by_key, legacy_ratio_kind)
	if not path then
		return
	end

	local handle = io.open(path, "r")
	if not handle then
		return
	end

	for line in handle:lines() do
		local kind, encoded_key, count, serialized = line:match("^(%S+)\t(%S+)\t(%d+)\t(.+)$")
		if not kind and legacy_ratio_kind then
			encoded_key, count, serialized = line:match("^(%S+)\t(%d+)\t(.+)$")
			kind = legacy_ratio_kind
		end

		if kind == "order" and serialized then
			local order = parse_strings(serialized)
			if #order == tonumber(count) then
				order_by_key[decode(encoded_key)] = order
			end
		elseif kind and ratio_tables_by_kind[kind] and serialized then
			local ratios = parse_numbers(serialized)
			if #ratios == tonumber(count) then
				ratio_tables_by_kind[kind][decode(encoded_key)] = ratios
			end
		end
	end

	handle:close()
end

return M
