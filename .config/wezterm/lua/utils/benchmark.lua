-- WezTerm Config Benchmark Utility
-- 
-- Usage: Copy and paste into debug overlay REPL (CTRL+SHIFT+D)
--        require("lua.utils.benchmark").run()

local M = {}

function M.run()
	print("\n" .. string.rep("=", 50))
	print("  WezTerm Config Quick Benchmark")
	print(string.rep("=", 50) .. "\n")

	local function benchmark(name, fn)
		local start = os.clock()
		local ok, result = pcall(fn)
		local elapsed = (os.clock() - start) * 1000
		
		if ok then
			print(string.format("✓  %-20s %.3fms", name, elapsed))
		else
			print(string.format("❌ %-20s FAILED: %s", name, tostring(result):sub(1, 40)))
		end
		return elapsed
	end

	-- Clear package cache for fresh benchmarks
	package.loaded["lua.base"] = nil
	package.loaded["lua.keys"] = nil
	package.loaded["lua.fonts"] = nil
	package.loaded["lua.colors"] = nil
	package.loaded["lua.layout"] = nil
	package.loaded["lua.tabs"] = nil
	package.loaded["lua.status"] = nil
	package.loaded["lua.platform"] = nil

	local total = 0
	total = total + benchmark("Base", function() return require("lua.base") end)
	total = total + benchmark("Keys", function() return require("lua.keys") end)
	total = total + benchmark("Fonts", function() return require("lua.fonts") end)
	total = total + benchmark("Colors", function() return require("lua.colors") end)
	total = total + benchmark("Layout", function() return require("lua.layout") end)
	total = total + benchmark("Tabs", function() return require("lua.tabs") end)
	total = total + benchmark("Status", function() return require("lua.status") end)
	total = total + benchmark("Platform", function() return require("lua.platform") end)

	print(string.rep("-", 52))
	print(string.format("Total: %.3fms", total))
	print(string.rep("=", 52))
	
	return total
end

return M
