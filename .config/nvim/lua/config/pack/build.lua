local M = {}

local builds = {
	["fff.nvim"] = "require('fff.download').download_or_build_binary()",
	["nvim-treesitter"] = "require('nvim-treesitter').update(nil, { summary = true }):wait()",
}

local function run_build(name, code)
	local site = vim.fs.joinpath(vim.fn.stdpath("data"), "site")
	local result = vim.system({
		vim.v.progpath,
		"--clean",
		"--headless",
		"--cmd",
		"set packpath^=" .. vim.fn.fnameescape(site),
		"+packadd " .. name,
		"+lua " .. code,
		"+qa",
	}, { text = true }):wait(300000)

	if result.code ~= 0 then
		error(("native build failed for %s:\n%s%s"):format(name, result.stdout or "", result.stderr or ""))
	end
end

function M.register()
	vim.api.nvim_create_autocmd("PackChanged", {
		group = vim.api.nvim_create_augroup("NativePackBuild", { clear = true }),
		callback = function(event)
			if event.data.kind ~= "install" and event.data.kind ~= "update" then
				return
			end

			local name = event.data.spec.name
			local code = builds[name]
			if code ~= nil then
				-- Build in a clean child so the shadow copy never joins Lazy's runtimepath.
				run_build(name, code)
			end
		end,
	})
end

return M
