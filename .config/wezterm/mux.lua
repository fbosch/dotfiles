local is_windows = package.config:sub(0, 1) == "\\"

return function(config)
	if is_windows then
		return
	end

	config.unix_domains = {
		{
			name = "unix",
		},
	}
end
