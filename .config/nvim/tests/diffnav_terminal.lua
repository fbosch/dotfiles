local repo_root = assert(vim.env.REPO_ROOT)
vim.opt.runtimepath:prepend(repo_root .. "/.config/nvim")

local root = vim.fn.tempname()
vim.fn.mkdir(root .. "/.git", "p")
root = assert(vim.uv.fs_realpath(root))
local selected = root .. "/file's space æøå %#|name.txt"
vim.fn.writefile({ "selected file" }, selected)
local original_cwd = vim.fn.getcwd()
local notices = {}
vim.notify = function(message)
	table.insert(notices, message)
end

local instances = {}
package.loaded.FTerm = {
	new = function(_, opts)
		local instance = { opts = opts, closes = {} }
		function instance:close(force)
			table.insert(self.closes, force or false)
			if self.win and vim.api.nvim_win_is_valid(self.win) then
				vim.api.nvim_win_close(self.win, true)
			end
			self.win = nil
		end
		function instance:toggle()
			if self.win and vim.api.nvim_win_is_valid(self.win) then
				return self:close()
			end
			self.buf = self.buf or vim.api.nvim_create_buf(false, true)
			self.win = vim.api.nvim_open_win(self.buf, true, {
				relative = "editor",
				row = 1,
				col = 1,
				width = 40,
				height = 10,
			})
			if not self.job then
				self.job = vim.fn.jobstart({ "cat" }, { term = true })
			end
		end
		table.insert(instances, instance)
		return instance
	end,
}

local function editor(instance, path)
	local result
	vim.system({ instance.opts.env.EDITOR, path }, {
		env = instance.opts.env,
		text = true,
	}, function(value)
		result = value
	end)
	assert(
		vim.wait(5000, function()
			return result ~= nil
		end),
		"editor RPC timed out"
	)
	assert(result.code == 0, result.stderr)
end

local ok, err = xpcall(function()
	vim.api.nvim_set_current_dir(root)
	require("plugins.workflow.terminal")[1].setup()
	local origin = vim.api.nvim_get_current_win()
	vim.cmd.FTermDiffnav()
	local instance = instances[#instances]
	assert(instance.opts.env.IN_NEOVIM == "1", "preserves shared environment")
	assert(instance.opts.env.NVIM ~= "", "explicit parent RPC server")
	local bin = root .. "/bin"
	vim.fn.mkdir(bin, "p")
	local shell = root .. "/reset-editor-shell"
	vim.fn.writefile({ "#!/bin/sh", "export EDITOR=nvim", 'exec /bin/sh "$@"' }, shell)
	vim.fn.writefile({ "#!/bin/sh", 'printf "%s" "$EDITOR" > "$DIFFNAV_TEST_ENV"' }, bin .. "/diffnav")
	assert(vim.uv.fs_chmod(shell, 493))
	assert(vim.uv.fs_chmod(bin .. "/diffnav", 493))
	local original_shell = vim.o.shell
	vim.o.shell = shell
	local env_file = root .. "/editor-env"
	local probe = vim.fn.jobstart(instance.opts.cmd, {
		env = vim.tbl_extend("force", instance.opts.env, {
			PATH = bin .. ":" .. vim.env.PATH,
			DIFFNAV_TEST_ENV = env_file,
		}),
	})
	local exit_code = vim.fn.jobwait({ probe }, 3000)[1]
	vim.o.shell = original_shell
	assert(exit_code == 0, "diffnav launch probe failed")
	assert(vim.fn.readfile(env_file)[1] == instance.opts.env.EDITOR, "shell startup must not replace diffnav EDITOR")
	local mapping = vim.fn.maparg("<CR>", "t", false, true)
	assert(mapping.buffer == 1 and mapping.rhs == "o", "Enter sends diffnav editor action")
	local buf, job = instance.buf, instance.job

	editor(instance, selected)
	assert(vim.api.nvim_get_current_win() == origin, "focus returns to launching window")
	assert(vim.api.nvim_buf_get_name(0) == selected, "literal filename opened through RPC")
	assert(not instance.win, "float hidden")
	assert(instance.closes[#instance.closes] == false, "terminal not killed")
	assert(vim.fn.jobwait({ job }, 0)[1] == -1, "terminal process remains alive")
	assert(vim.fn.maparg("<CR>", "t") == "", "Enter mapping does not leak into other buffers")

	vim.cmd.FTermDiffnav()
	assert(instances[#instances] == instance and instance.buf == buf, "same session reused")
	vim.cmd.FTermDiffnav()
	assert(not instance.win, "toggle from terminal does not resolve terminal URI as repository")
	assert(#instances == 2, "one default terminal and one diffnav terminal")

	vim.cmd.FTermDiffnav()
	assert(not require("utils.diffnav").open_file(root), "directories rejected")
	assert(not require("utils.diffnav").open_file(root .. "/deleted"), "deleted files rejected")
	assert(instance.win and vim.api.nvim_win_is_valid(instance.win), "invalid paths keep float open")
	instance:close()

	vim.o.hidden = false
	vim.api.nvim_buf_set_lines(0, 0, -1, false, { "unsaved" })
	local other = root .. "/other.txt"
	vim.fn.writefile({ "other" }, other)
	vim.cmd.FTermDiffnav()
	assert(not require("utils.diffnav").open_file(other), "unsaved buffer not forced away")
	assert(vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(origin), 0, -1, false)[1] == "unsaved")
	assert(#notices >= 3, "failed selections are reported")
	instance:close()
	vim.bo.modified = false

	vim.cmd.vsplit()
	local closed_origin = vim.api.nvim_get_current_win()
	vim.cmd.FTermDiffnav()
	vim.api.nvim_win_close(closed_origin, true)
	editor(instance, other)
	assert(vim.api.nvim_get_current_win() == origin, "closed origin falls back to editor window")
	assert(vim.api.nvim_buf_get_name(0) == other, "fallback opens selected file")
end, debug.traceback)

for _, instance in ipairs(instances) do
	instance:close()
	if instance.job then
		vim.fn.jobstop(instance.job)
	end
end
vim.api.nvim_set_current_dir(original_cwd)
vim.fn.delete(root, "rf")
if not ok then
	error(err)
end
print("diffnav terminal tests passed")
vim.cmd.qa()
