local map = require("utils").set_keymap
local kagi = require("utils.kagi")
local web = require("utils.web")

-- kagi
map("n", "<leader>/a", kagi.prompt_fastgpt, "Prompt Kagi FastGPT")
map("n", "<leader>/p", kagi.show_previous_response, "Show previous Kagi response")
map("n", "<leader>/s", kagi.summarize_nearest_url, "Summarize URL under cursor with Kagi")
map("n", "<leader>//", kagi.search_query, "Search in browser with Kagi")

-- web
map("n", "<leader>ou", web.open_uris_in_buffer, "Open all URIs in current buffer")
map("x", "<leader>ou", web.open_uris_in_selection, "Open all URIs in selection")
map("n", "<leader>ow", web.open_branch_workitem, "Open the workitem associated with the current branch in browser")
map("n", "<leader>og", web.open_git_remote_url, "Open the remote url for the current repository in the browser")
