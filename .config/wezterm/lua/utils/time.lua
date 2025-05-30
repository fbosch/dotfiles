local M = {}

function M.parse_time(time_str)
	if not time_str then
		return nil
	end
	local hour, minute, second = time_str:match("(%d+):(%d+):(%d+)")
	if not (hour and minute and second) then
		return nil
	end
	return tonumber(hour), tonumber(minute), tonumber(second)
end

function M.calculate_hour_difference(time_str1, time_str2)
	if not time_str1 or not time_str2 then
		return nil, "Invalid input: one or both time strings are nil"
	end

	local hour1, minute1, second1 = M.parse_time(time_str1)
	local hour2, minute2, second2 = M.parse_time(time_str2)

	if not (hour1 and minute1 and second1 and hour2 and minute2 and second2) then
		return nil, "Invalid input: unable to parse time strings"
	end

	-- Convert times to seconds
	local totalSeconds1 = hour1 * 3600 + minute1 * 60 + second1
	local totalSeconds2 = hour2 * 3600 + minute2 * 60 + second2

	-- Calculate the difference in seconds
	local differenceInSeconds = totalSeconds2 - totalSeconds1

	-- Convert the difference back to hours
	local differenceInHours = differenceInSeconds / 3600

	return differenceInHours
end

return M
