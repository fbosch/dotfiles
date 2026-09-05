local map = require("utils").set_keymap
local web = require("utils.web")

local function focus_pi()
	require("plugins.ai.pi").start()
end

-- Pi reads the recorded editor state over its bound channel; these mappings never inject terminal input.
map({ "n", "x" }, "<leader>ac", focus_pi, "Focus Pi with source context")
map({ "n", "x" }, "ga", focus_pi, "Add source context to Pi")
map("n", "<C-\\>", focus_pi, "Focus Pi")
map({ "n", "t" }, "<A-a>", function()
	require("plugins.ai.pi").toggle()
end, "Toggle Pi")
map("n", "<A-x>", focus_pi, "Focus Pi with visible buffers")
map("x", "<A-x>", focus_pi, "Focus Pi with selection")
map({ "n", "t" }, "<leader>aO", "<Cmd>OpenCodeToggle<CR>", "Toggle OpenCode rollback")

-- web
map("n", "<leader>ou", web.open_uris_in_buffer, "Open all URIs in current buffer")
map("x", "<leader>ou", web.open_uris_in_selection, "Open all URIs in selection")
map("n", "<leader>ow", web.open_branch_workitem, "Open the workitem associated with the current branch in browser")
map("n", "<leader>og", web.open_git_remote_url, "Open the remote url for the current repository in the browser")
