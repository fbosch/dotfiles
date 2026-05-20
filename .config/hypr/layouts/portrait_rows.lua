local M = {}

function M.recalculate(ctx)
	local targets = ctx.targets or {}
	local count = #targets

	if count == 0 then
		return
	end

	if count == 1 then
		targets[1]:place(ctx.area)
		return
	end

	if count == 2 then
		targets[1]:place(ctx:split(ctx.area, "top", 1 / 3))
		targets[2]:place(ctx:split(ctx.area, "bottom", 2 / 3))
		return
	end

	for index = 1, count do
		targets[index]:place(ctx:row(index, count))
	end
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
})

return M
