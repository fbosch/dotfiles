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

return {
	{
		"linw1995/nvim-mcp",
		lazy = false,
		build = "cargo install --path .",
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
