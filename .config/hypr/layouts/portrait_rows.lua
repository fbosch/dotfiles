local M = {}

function M.recalculate(ctx)
	local targets = ctx.targets or {}
	local count = #targets
	local area = ctx.area

	if count == 0 then
		return
	end

	if count == 1 then
		targets[1]:place(area)
		return
	end

	local x = area.x
	local y = area.y
	local width = area.w
	local height = area.h

	if count == 2 then
		local top_height = height / 3
		targets[1]:place({ x = x, y = y, w = width, h = top_height })
		targets[2]:place({ x = x, y = y + top_height, w = width, h = height - top_height })
		return
	end

	local row_height = height / count
	for index = 1, count do
		targets[index]:place({ x = x, y = y + row_height * (index - 1), w = width, h = row_height })
	end
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
})

return M
