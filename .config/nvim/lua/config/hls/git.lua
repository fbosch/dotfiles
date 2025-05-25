local colors = require("config.colors")
return {
	GitSignsAdded = { fg = colors.green },
	GitSignsChanged = { fg = colors.yellow },
	GitSignsRemoved = { fg = colors.red },
}
