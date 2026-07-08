local M = {}

function M.target_index(targets, target, active_index)
	if target then
		for index = 1, #targets do
			if targets[index] == target then
				return index
			end
		end
	end

	return active_index(targets)
end

function M.delta_ratio(delta, axis, span, fallback)
	local amount = delta and delta[axis] or fallback
	if not amount then
		return nil
	end

	if math.abs(amount) <= 1 then
		return amount
	end

	if not span or span == 0 then
		return amount > 0 and fallback or -fallback
	end

	return amount / span
end

function M.clamp_delta(first, second, delta, min_ratio)
	if delta > 0 then
		return math.min(delta, second - min_ratio)
	end

	return math.max(delta, min_ratio - first)
end

function M.adjust_boundary(ratios, first_index, delta, min_ratio)
	local second_index = first_index + 1
	if not ratios[first_index] or not ratios[second_index] or not delta then
		return
	end

	delta = M.clamp_delta(ratios[first_index], ratios[second_index], delta, min_ratio)
	ratios[first_index] = ratios[first_index] + delta
	ratios[second_index] = ratios[second_index] - delta
end

function M.adjust_active(ratios, index, count, delta, min_ratio)
	if not delta or delta == 0 then
		return
	end

	if delta > 0 then
		if index < count then
			M.adjust_boundary(ratios, index, delta, min_ratio)
		else
			M.adjust_boundary(ratios, index - 1, delta, min_ratio)
		end
	elseif index > 1 then
		M.adjust_boundary(ratios, index - 1, delta, min_ratio)
	else
		M.adjust_boundary(ratios, index, delta, min_ratio)
	end
end

function M.boundary_for_edge(index, count, edge)
	if count < 2 then
		return nil
	end

	if index <= 1 then
		return 1
	end

	if index >= count then
		return count - 1
	end

	if edge == "left" or edge == "up" then
		return index - 1
	end

	return index
end

function M.set_boundary_at(ratios, boundary_index, position, area_start, area_span, min_ratio)
	if not boundary_index or not position or not area_start or not area_span or area_span == 0 then
		return
	end

	local before = 0
	for index = 1, boundary_index - 1 do
		before = before + ratios[index]
	end

	local current = before + ratios[boundary_index]
	local target = (position - area_start) / area_span
	local min_target = before + min_ratio
	local max_target = before + ratios[boundary_index] + ratios[boundary_index + 1] - min_ratio
	target = math.max(min_target, math.min(max_target, target))

	M.adjust_boundary(ratios, boundary_index, target - current, min_ratio)
end

return M
