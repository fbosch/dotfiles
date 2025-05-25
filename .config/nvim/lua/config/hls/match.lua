local colors = require("config.colors")
return {
	MatchParen = { fg = colors.darker_gray, bg = colors.match_blue },
	IncSearch = { bg = colors.purple, fg = colors.darker_gray, bold = true },
	Substitute = { bg = colors.orange, fg = colors.darker_gray },
	SpellBad = { undercurl = true, sp = colors.mispell_red },
	Folded = { fg = colors.lighter_gray, bg = colors.darker_gray },
	LocalHighlight = { bg = colors.gray },
}
