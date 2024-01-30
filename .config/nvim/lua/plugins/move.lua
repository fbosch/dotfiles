return {
	"fedepujol/move.nvim",
	-- move lines with Alt + hjkl
	keys = {
		{
			mode = { "n" },
			"<A-j>",
			"<cmd>MoveLine(1)<cr>",
			desc = "move line down",
		},
		{
			mode = { "n" },
			"<A-k>",
			"<cmd>MoveLine(-1)<cr>",
			desc = "move line up",
		},
		{
			mode = { "v" },
			"<A-j>",
			"<cmd>MoveBlock(1)<cr>",
			desc = "move block down",
		},
		{
			mode = { "v" },
			"<A-k>",
			"<cmd>MoveBlock(-1)<cr>",
			desc = "move block up",
		},
		-- {
		-- 	mode = { "n" },
		-- 	"<A-l>",
		-- 	"<cmd>MoveHChar(1)<cr>",
		-- 	desc = "move char right",
		-- },
		-- {
		-- 	mode = { "n" },
		-- 	"<A-h>",
		-- 	"<cmd>MoveHChar(-1)<cr>",
		-- 	desc = "move char left",
		-- },
		-- {
		-- 	mode = { "v" },
		-- 	"<A-l>",
		-- 	"<cmd>MoveHBlock(1)<cr>",
		-- 	desc = "move block right",
		-- },
		-- {
		-- 	mode = { "v" },
		-- 	"<A-h>",
		-- 	"<cmd>MoveHBlock(-1)<cr>",
		-- 	desc = "move block left",
		-- },
	},
	event = { "BufReadPre", "BufNewFile" },
}
