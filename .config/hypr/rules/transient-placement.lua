local dialog_classes = {
	zenity = true,
	["org.gnome.FileRoller"] = true,
}

local function centered_position(parent, dialog)
	if not parent.at or not parent.size or not dialog.at or not dialog.size then
		return nil
	end

	return {
		x = math.floor(parent.at.x + (parent.size.x - dialog.size.x) / 2 + 0.5),
		y = math.floor(parent.at.y + (parent.size.y - dialog.size.y) / 2 + 0.5),
	}
end

hl.on("window.open", function(dialog)
	if dialog_classes[dialog.class] ~= true then
		return
	end

	local parent = hl.get_last_window()
	if not parent or parent.class ~= "nemo" then
		return
	end

	local position = centered_position(parent, dialog)
	if not position then
		return
	end

	hl.dispatch(hl.dsp.window.move({
		x = position.x,
		y = position.y,
		window = "address:" .. dialog.address,
	}))
end)
