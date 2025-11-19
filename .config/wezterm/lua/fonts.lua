local wezterm = require("wezterm")

return function(config)
	config.font = wezterm.font_with_fallback({
		{
			family = "Zenbones Brainy",
			harfbuzz_features = { "calt=0", "clig=0", "liga=0" },
			weight = 500,
		},
		{
			family = "JetBrains Mono",
			harfbuzz_features = { "calt=0", "clig=0", "liga=0" },
		},
		{ family = "Symbols Nerd Font Mono", scale = 0.9 },
		{ family = "BabelStone Runic Elder Futhark" },
		"Noto Sans Runic",
		"Apple Color Emoji",
		"Segoe UI Emoji",
	})
	config.line_height = 1
	config.font_size = 16.0
	config.underline_thickness = "0.08cell"
	config.underline_position = "-0.16cell"
	config.cursor_thickness = 1
	config.custom_block_glyphs = true
end
