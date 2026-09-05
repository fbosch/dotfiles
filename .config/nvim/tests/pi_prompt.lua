local repo_root = assert(vim.env.REPO_ROOT)
package.path = table.concat({
	repo_root .. "/.config/nvim/lua/?.lua",
	repo_root .. "/.config/nvim/lua/?/init.lua",
	package.path,
}, ";")

local prompt = require("plugins.ai.pi.prompt")
assert(prompt.validate(" \n\t") == "PI_PROMPT_EMPTY")
assert(prompt.validate(vim.fn.nr2char(0x0085) .. vim.fn.nr2char(0x00A0)) == "PI_PROMPT_EMPTY")
assert(prompt.validate(string.char(0xFF)) == "PI_INVALID_UTF8")
assert(prompt.validate(string.rep("a", 16 * 1024 + 1)) == "PI_PROMPT_TOO_LARGE")
assert(prompt.validate("/review æøå 🚀") == nil)

dofile(repo_root .. "/.config/nvim/tests/pi_prompt_owner.lua")
dofile(repo_root .. "/.config/nvim/tests/pi_prompt_context.lua")
