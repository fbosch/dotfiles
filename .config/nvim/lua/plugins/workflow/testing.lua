-- helper to find nearest parent dir containing a file
local function upfind(start, name)
	local dir = start
	while dir and dir ~= "/" do
		if vim.fn.filereadable(dir .. "/" .. name) == 1 then
			return dir
		end
		dir = vim.fn.fnamemodify(dir, ":h")
	end
end

return {
	{
		"nvim-neotest/neotest",
		dependencies = {
			"nvim-neotest/nvim-nio",
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"marilari88/neotest-vitest",
		},
		keys = {
			{
				"<space>tr",
				function()
					local file_dir = vim.fn.expand("%:p:h")
					local pkg_dir = upfind(file_dir, "package.json") or file_dir
					require("neotest").run.run({
						cwd = pkg_dir, -- run inside nearest package
					})
				end,
				desc = "Run nearest test",
				silent = true,
			},
			{
				"<space>tw",
				function()
					local file = vim.fn.expand("%:p") -- watch current file
					require("neotest").watch.toggle(file)
				end,
				desc = "Watch current file",
				silent = true,
			},
			{
				"<space>tW",
				function()
					local pkg_dir = upfind(vim.fn.expand("%:p:h"), "package.json") or vim.loop.cwd()
					require("neotest").watch.toggle(pkg_dir) -- watch entire package
				end,
				desc = "Watch entire package",
				silent = true,
			},
		},
		config = function()
			require("neotest").setup({
				adapters = {
					require("neotest-vitest")({
						vitestCommand = "pnpm vitest", -- set command here
						filter_dir = function(name)
							return name ~= "node_modules"
						end,
					}),
				},
				quickfix = { enabled = false, open = false },
				output_panel = { enabled = true, open = "rightbelow vsplit | resize 30" },
				status = { enabled = true, virtual_text = false, signs = true },
			})
			-- ensure Vitest watch is allowed
			vim.env.CI = vim.env.CI == "true" and "" or vim.env.CI
		end,
	},
}
