local M = {}
local one_third = 1 / 3
local box = {}

local function monitor_name(targets)
	for index = 1, #targets do
		local window = targets[index].window
		local monitor = window and window.monitor
		if monitor and monitor.name then
			return monitor.name
		end
	end

	return nil
end

local function place_rows(targets, count, x, y, width, height)
	local row_height = height / count
	box.x = x
	box.w = width
	box.h = row_height

	for index = 1, count do
		box.y = y + row_height * (index - 1)
		targets[index]:place(box)
	end
end

function M.recalculate(ctx)
	local targets = ctx.targets
	if not targets then
		return
	end

	local count = #targets

	if count == 0 then
		return
	end

	local area = ctx.area

	if count == 1 then
		targets[1]:place(area)
		return
	end

	local x = area.x
	local y = area.y
	local width = area.w
	local height = area.h

	if monitor_name(targets) ~= "HDMI-A-2" then
		place_rows(targets, count, x, y, width, height)
		return
	end

	box.x = x
	box.y = y
	box.w = width
	box.h = height

	if count == 2 then
		local top_height = height * one_third
		box.h = top_height
		targets[1]:place(box)

		box.y = y + top_height
		box.h = height - top_height
		targets[2]:place(box)
		return
	end

	if count == 3 then
		local row_height = height * one_third
		box.h = row_height
		targets[1]:place(box)

		box.y = y + row_height
		targets[2]:place(box)

		box.y = y + row_height * 2
		targets[3]:place(box)
		return
	end

	place_rows(targets, count, x, y, width, height)
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
})

return M
