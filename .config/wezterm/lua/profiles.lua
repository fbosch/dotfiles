return function(config)
	local profile_name = os.getenv("WEZTERM_PROFILE")

	local function apply_floating_tool_profile()
		config.enable_tab_bar = false
		config.hide_tab_bar_if_only_one_tab = true
		config.show_new_tab_button_in_tab_bar = false
		config.window_close_confirmation = "NeverPrompt"
		config.window_padding = {
			left = 2,
			right = 2,
			top = -1,
			bottom = 0,
		}
	end

	if profile_name == "floating_tool" then
		apply_floating_tool_profile()
	end
end
