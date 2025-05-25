local colors = require("config.colors")
return {
	NotifyBackground = { bg = colors.background },
	NotifyERRORBorder = { fg = colors.red },
	NotifyWARNBorder = { fg = colors.orange },
	NotifyINFOBorder = { fg = colors.dark_gray },
	NotifyDEBUGBorder = { fg = colors.lighter_gray },
	NotifyTRACEBorder = { fg = colors.purple },
	NotifyERRORIcon = { fg = colors.red },
	NotifyWARNIcon = { fg = colors.orange },
	NotifyINFOIcon = { fg = colors.blue },
	NotifyDEBUGIcon = { fg = colors.lighter_gray },
	NotifyTRACEIcon = { fg = colors.purple },
	NotifyERRORTitle = { fg = colors.red },
	NotifyWARNTitle = { fg = colors.orange },
	NotifyINFOTitle = { fg = colors.lighter_gray },
	NotifyDEBUGTitle = { fg = colors.lighter_gray },
	NotifyTRACETitle = { fg = colors.purple },
}
