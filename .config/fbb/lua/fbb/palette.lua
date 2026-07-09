local paths = require("fbb.paths")

local M = {}

local function read_all(path)
	local file = assert(io.open(path, "r"))
	local content = file:read("*a")
	file:close()
	return content
end

function M.zenwritten_dark(config_home, decode_json)
	assert(type(decode_json) == "function", "decode_json must be a function")

	local content = read_all(paths.data_path("palette.json", config_home))
	local root = decode_json(content)
	assert(type(root.zenwritten) == "table", "missing zenwritten palette")
	assert(type(root.zenwritten.dark) == "table", "missing zenwritten dark palette")

	local palette = root.zenwritten.dark
	local ansi = assert(palette.ansi, "missing zenwritten dark ANSI palette")
	local semantic = assert(palette.semantic, "missing zenwritten dark semantic palette")

	return palette, ansi, semantic
end

return M
