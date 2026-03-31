local function find_socket_path()
	for _, server in ipairs(vim.fn.serverlist()) do
		if type(server) == "string" then
			local basename = vim.fs.basename(server)
			if basename:find("^nvim%-mcp%..+%.sock$") ~= nil then
				return server
			end
		end
	end

	return nil
end

local function build_nvim_mcp()
	if vim.fn.executable("cargo") == 1 then
		vim.fn.system({ "cargo", "install", "--path", "." })
		if vim.v.shell_error == 0 then
			return
		end

		error("nvim-mcp build failed: cargo install --path .")
	end

	if vim.fn.executable("nvim-mcp") == 1 then
		return
	end

	vim.notify("nvim-mcp: skipping build (cargo not found, binary not in PATH)", vim.log.levels.WARN)
end

return {
	{
		"linw1995/nvim-mcp",
		lazy = false,
		build = build_nvim_mcp,
		opts = {},
		config = function(_, opts)
			require("nvim-mcp").setup(opts)

			local socket_path = find_socket_path()
			if type(socket_path) == "string" and socket_path ~= "" then
				vim.env.NVIM_MCP_SOCKET = socket_path
				return
			end

			vim.env.NVIM_MCP_SOCKET = nil
		end,
	},
}
