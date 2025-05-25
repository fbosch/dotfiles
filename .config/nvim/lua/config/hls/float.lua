local colors = require("config.colors")
local border_color = { fg = colors.light_gray }
return {
	NormalFloat = { bg = colors.background },
	FloatBorder = border_color,
	LspInfoBorder = border_color,
	FzfLuaBorder = border_color,
	NormalFloatBorder = border_color,
	Pmenu = { bg = colors.background },
	Beacon = { bg = colors.lighter_gray, ctermbg = 15 },
}
