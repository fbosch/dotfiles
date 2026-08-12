local map = require("utils").set_keymap
local web = require("utils.web")

-- web
map("n", "<leader>ou", web.open_uris_in_buffer, "Open all URIs in current buffer")
map("x", "<leader>ou", web.open_uris_in_selection, "Open all URIs in selection")
map("n", "<leader>ow", web.open_branch_workitem, "Open the workitem associated with the current branch in browser")
map("n", "<leader>og", web.open_git_remote_url, "Open the remote url for the current repository in the browser")
