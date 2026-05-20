local M = {}
local one_third = 1 / 3

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
	local box = { x = x, y = y, w = width, h = height }

	if count == 2 then
		local top_height = height * one_third
		box.h = top_height
		targets[1]:place(box)

		box.y = y + top_height
		box.h = height - top_height
		targets[2]:place(box)
		return
	end

	local row_height = height / count
	for index = 1, count do
		box.y = y + row_height * (index - 1)
		box.h = row_height
		targets[index]:place(box)
	end
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
})

return M
