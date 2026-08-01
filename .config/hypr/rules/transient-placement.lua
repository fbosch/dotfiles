local M = {}

-- Add children under the class of the window that opens them.
local child_classes_by_parent_class = {
	nemo = {
		"zenity",
		"org.gnome.FileRoller",
	},
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

function M.register()
	hl.on("window.open", function(dialog)
		local parent = hl.get_last_window()
		local child_classes = parent and child_classes_by_parent_class[parent.class]
		if not child_classes then
			return
		end

		local matches_child_class = false
		for _, child_class in ipairs(child_classes) do
			if child_class == dialog.class then
				matches_child_class = true
				break
			end
		end
		if matches_child_class == false then
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
end

return M
