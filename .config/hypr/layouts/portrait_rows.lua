local M = {}

local function ordered_targets(ctx)
	local ordered = {}

	for _, target in ipairs(ctx.targets or {}) do
		ordered[#ordered + 1] = target
	end

	return ordered
end

function M.recalculate(ctx)
	local targets = ordered_targets(ctx)
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

	for index, target in ipairs(targets) do
		target:place(ctx:row(index, count))
	end
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
})

return M
