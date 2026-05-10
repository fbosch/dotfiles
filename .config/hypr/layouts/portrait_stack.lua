hl.layout.register("portrait_stack", {
	recalculate = function(ctx)
		local n = #ctx.targets
		if n == 0 then
			return
		end

		if n == 2 then
			ctx.targets[1]:place(ctx:split(ctx.area, "top", 1 / 3))
			ctx.targets[2]:place(ctx:split(ctx.area, "bottom", 2 / 3))
			return
		end

		for i, target in ipairs(ctx.targets) do
			target:place(ctx:row(i, n))
		end
	end,
})
