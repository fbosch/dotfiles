local wezterm = require("wezterm")

local function format_tab_title(tab, tabs, panes, config, hover, max_width)
	local title = "" .. Tab_title(tab) .. " "

	local tab_title = {
		{ Foreground = { Color = "#636363" } },
		{ Text = " [" .. tab.tab_index + 1 .. "] " },
	}

	if string.starts(title, "nvim") then
		table.insert(tab_title, { Foreground = { Color = "#54a23d" } })
		table.insert(tab_title, { Text = wezterm.nerdfonts.dev_neovim })
		title = string.gsub(title, "nvim", "")
	end

	if string.starts(title, "brew") then
		table.insert(tab_title, { Foreground = { Color = "#c0a23d" } })
		table.insert(tab_title, { Text = wezterm.nerdfonts.md_glass_mug_variant })
		title = string.gsub(title, "brew", "")
	end

	if string.starts(title, "fish") then
		table.insert(tab_title, { Foreground = { Color = "#97bdde" } })
		table.insert(tab_title, { Text = wezterm.nerdfonts.md_fish })
		title = string.gsub(title, "fish", "")
	end

	if string.starts(title, "wsl") then
		table.insert(tab_title, { Foreground = { Color = "#e95420" } })
		table.insert(tab_title, { Text = wezterm.nerdfonts.cod_terminal_ubuntu })
		title = string.gsub(title, "wsl.exe", "")
		title = string.gsub(title, "wslhost.exe", "")
	end

	if string.starts(title, "cargo") then
		table.insert(tab_title, { Foreground = { Color = "#CE412B" } })
		table.insert(tab_title, { Text = wezterm.nerdfonts.md_language_rust })
		title = string.gsub(title, "cargo", "")
	end

	if string.starts(title, "lazygit") then
		table.insert(tab_title, { Foreground = { Color = "#e84e32" } })
		table.insert(tab_title, { Text = wezterm.nerdfonts.md_git })
		title = string.gsub(title, "lazygit", "")
	end

	if string.starts(title, "git") then
		table.insert(tab_title, { Foreground = { Color = "#e84e32" } })
		if string.starts(title, "git pull") then
			table.insert(tab_title, { Text = wezterm.nerdfonts.cod_repo_pull })
			title = string.gsub(title, "git pull", "")
		end
		if string.starts(title, "git commit") then
			table.insert(tab_title, { Text = wezterm.nerdfonts.cod_repo_commit })
			title = string.gsub(title, "git commit", "")
		end
		if string.starts(title, "git push") then
			table.insert(tab_title, { Text = wezterm.nerdfonts.cod_repo_push })
			title = string.gsub(title, "git push", "")
		end
	end

	table.insert(tab_title, { Foreground = { Color = "#bbbbbb" } })
	table.insert(tab_title, { Text = title })
	return tab_title
end

return function(config)
	config.tab_bar_at_bottom = true
	config.use_fancy_tab_bar = false
	config.hide_tab_bar_if_only_one_tab = false
	config.show_new_tab_button_in_tab_bar = false
	config.tab_max_width = 128

	wezterm.on("format-tab-title", format_tab_title)
end
