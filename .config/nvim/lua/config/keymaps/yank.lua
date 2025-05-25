local map = require("utils").set_keymap
local yank = require("utils.yank")

-- paste last thing yanked (not system copied), not deleted
map("n", ",p", '"0p')
map("n", ",P", '"0P')

-- don't yank on put
map("x", "p", '"_dP')

-- special yanking utilities
map("n", "<leader>yf", ":%y<cr>", "Yank current buffer")
map("n", "<leader>yd", yank.cursor_diagnostics, "Yank diagnostic message under cursor")
map("n", "<leader>yad", yank.all_diagnostics, "Yank all diagnostics in buffer")
map("x", "<leader>ym", yank.selection_to_markdown, "Yank visual selection as markdown code block")
map("n", "<leader>yfm", yank.file_to_markdown, "Yank current buffer as markdown code block")
