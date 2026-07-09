local M = {}
local config_home = vim.fn.fnamemodify(vim.fn.stdpath("config"), ":h")
package.path = config_home .. "/fbb/lua/?.lua;" .. package.path
local palette, ansi, semantic = require("fbb.palette").zenwritten_dark(config_home, vim.json.decode)

M.white = "#ffffff"
M.background = palette.background
M.lighter_gray = palette.foreground
M.light_gray = semantic.muted
M.gray = "#303030"
M.dark_gray = semantic.panel
M.darker_gray = "#252525"
M.darkest_gray = "#1d1d1d"
M.almost_black = "#131313"

M.mispell_red = "#A8334C"
M.match_blue = "#6e8aa5"
M.search_backdrop = "#797979"

M.red = ansi.red
M.orange = ansi.brightYellow
M.blue = semantic.blue
M.dark_blue = ansi.blue
M.purple = ansi.magenta
M.yellow = ansi.brightYellow
M.green = ansi.brightGreen
M.cyan = ansi.brightCyan

M.highlight_args = {
	"#9ec5cb",
	"#9f97ab",
	"#9dc0ab",
	"#f6c890",
	"#c6deb2",
	"#dfda97",
	"#f3ccd1",
	"#b9b0d8",
	"#c69eb6",
	"#96b492",
	"#80a9c8",
	"#e9b3aa",
	"#dcbdec",
	"#a1f2b5",
	"#f2e3a8",
	"#a8d0e6",
	"#f9a7c3",
	"#90dce5",
	"#cceaff",
	"#7aacb7",
	"#66d9ef",
	"#dfd096",
	"#c5cae9",
	"#87c38f",
	"#e5d8b6",
	"#9c89b8",
	"#ffd28a",
	"#a3bffa",
	"#b3a2c7",
	"#93c5b4",
	"#66b3a7",
	"#e5d7b2",
	"#ffbdb7",
	"#a4c0c9",
	"#bfaecd",
	"#f9a7c3",
	"#90dce5",
	"#cceaff",
	"#8fbcbb",
	"#ffd7be",
	"#66d9ef",
	"#ff99cc",
	"#ccb3ff",
	"#33ccff",
}

return M
