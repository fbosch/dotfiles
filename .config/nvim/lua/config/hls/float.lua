local colors = require("config.colors")
local border_color = { fg = colors.light_gray }
return {
	NormalFloat = { bg = colors.background },
	FloatBorder = border_color,
	LspInfoBorder = border_color,
	NormalFloatBorder = border_color,
	Pmenu = { bg = colors.background },
	Beacon = { bg = colors.match_blue, ctermbg = 15 },
	FloatShadow = { bg = colors.almost_black },
}
