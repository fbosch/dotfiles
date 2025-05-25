local hls = require("utils.fn").require_dir_modules(vim.fn.stdpath("config") .. "/lua/config/hls")

for _, group in pairs(hls) do
	require("utils").load_highlights(group)
end
