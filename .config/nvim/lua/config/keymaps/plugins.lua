local map = require("utils").set_keymap
local kagi = require("utils.kagi")
local web = require("utils.web")

-- kagi
map("n", "<leader>ka", kagi.prompt_fastgpt, "Prompt Kagi FastGPT")
map("n", "<leader>kp", kagi.show_previous_response, "Show previous Kagi response")
map("n", "<leader>ks", kagi.summarize_nearest_url, "Summarize URL under cursor with Kagi")
map("n", "<leader>ko", kagi.search_query, "Search in browser with Kagi")

-- web
map("n", "<leader>oa", web.open_uris_in_buffer, "Open all URIs in current buffer")
map("x", "<leader>oa", web.open_uris_in_selection, "Open all URIs in selection")

map("n", "<leader>gr", function()
	local git_remote_url = require("utils.git").get_remote_url()
	local azure_org_url = require("utils.git").extract_azure_org(git_remote_url)

	-- print(git_remote_url)
	print(azure_org_url)
end, "Open all URIs in current buffer")
