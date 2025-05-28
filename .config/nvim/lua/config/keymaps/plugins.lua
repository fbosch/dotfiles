local map = require("utils").set_keymap
local kagi = require("utils.kagi")
local web = require("utils.web")

-- kagi
map("n", "<leader>/a", kagi.prompt_fastgpt, "Prompt Kagi FastGPT")
map("n", "<leader>/p", kagi.show_previous_response, "Show previous Kagi response")
map("n", "<leader>/s", kagi.summarize_nearest_url, "Summarize URL under cursor with Kagi")
map("n", { "<leader>//", "<leader>--" }, kagi.search_query, "Search in browser with Kagi") -- nordic keyboard

-- web
map("n", "<leader>ou", web.open_uris_in_buffer, "Open all URIs in current buffer")
map("x", "<leader>ou", web.open_uris_in_selection, "Open all URIs in selection")
map("n", "<leader>ow", web.open_branch_workitem, "Open the workitem associated with the current branch in browser")
