local repo_root = assert(vim.env.REPO_ROOT)
vim.opt.runtimepath:prepend(repo_root .. "/.config/nvim")
local options
package.loaded.lualine = {
	setup = function(value)
		options = value
	end,
	refresh = function() end,
}
local declaration = dofile(repo_root .. "/.config/nvim/lua/plugins/ui/statusline.lua")
assert(#vim.api.nvim_get_autocmds({ group = vim.api.nvim_create_augroup("LualineGitRepo", {}) }) == 0)
declaration.setup()
local function branch()
	return options.sections.lualine_b[1].cond()
end
local function blame()
	return options.sections.lualine_c[1].cond()
end
local discovery_calls = 0
local root = vim.fs.root
vim.fs.root = function(...)
	discovery_calls = discovery_calls + 1
	return root(...)
end
local temp = vim.fn.tempname()
local inside, outside = temp .. "/repo", temp .. "/plain"
vim.fn.mkdir(inside .. "/.git", "p")
vim.fn.mkdir(outside, "p")
vim.fn.writefile({ "fixture" }, inside .. "/file")
vim.fn.writefile({ "fixture" }, outside .. "/file")
local function edit(path)
	vim.cmd.edit(vim.fn.fnameescape(path))
end
local function event(name, pattern)
	vim.api.nvim_exec_autocmds(name, { group = "LualineGitRepo", pattern = pattern })
end
local function cached(expected)
	local before = discovery_calls
	for _ = 1, 100 do
		assert(branch() == expected, "incorrect repository condition")
		vim.b.gitsigns_blame_line = "author"
		assert(blame() == expected, "branch and blame must share discovery")
	end
	assert(discovery_calls == before + 1, "200 conditions must perform one discovery, including negative results")
end
edit(inside .. "/file")
cached(true)
local first_buf = vim.api.nvim_get_current_buf()
edit(outside .. "/file")
cached(false)
vim.api.nvim_set_current_buf(first_buf)
cached(true)

-- The shared helper must still detect repository changes immediately.
vim.fn.delete(inside .. "/.git", "d")
assert(require("utils.git").is_git_repo() == false)
assert(branch() == true)
event("FocusGained")
cached(false)
vim.fn.mkdir(inside .. "/.git")
event("User", "StatuslineGitChanged")
cached(true)

vim.api.nvim_buf_set_name(0, outside .. "/renamed")
cached(false)
vim.api.nvim_buf_set_name(0, inside .. "/new-file")
cached(true)
vim.cmd.write()
cached(true)

-- Symlink target changes are discovered at the same external-change boundaries.
local link = outside .. "/link"
assert(vim.uv.fs_symlink(inside .. "/file", link))
edit(link)
-- Neovim may reuse the target buffer; retain the link name for this case.
vim.api.nvim_buf_set_name(0, link)
cached(true)
assert(vim.uv.fs_unlink(link))
assert(vim.uv.fs_symlink(outside .. "/file", link))
event("FocusGained")
cached(false)

vim.cmd.enew()
vim.cmd.cd(inside)
cached(true)
vim.cmd.cd(outside)
cached(false)
vim.cmd.lcd(inside)
cached(true)
vim.cmd.tcd(outside)
cached(false)

-- One unnamed buffer can be displayed in windows with different local cwd.
vim.cmd.vsplit()
vim.cmd.lcd(inside)
cached(true)
vim.cmd.wincmd("p")
cached(false)
vim.cmd.wincmd("p")
cached(true)
vim.cmd.only()

for _, name in ipairs({ "ShellCmdPost", "TermClose", "DirChanged", "BufEnter", "WinEnter", "BufWritePost" }) do
	event(name)
	cached(true)
end
event("User", "FugitiveChanged")
cached(true)

-- Ordinary redraw/edit events must not invalidate the cache.
local before = discovery_calls
for _, name in ipairs({ "CursorMoved", "CursorMovedI", "TextChangedI" }) do
	event(name)
	assert(branch())
end
assert(discovery_calls == before)

-- Exercise eviction before wiping the real buffer.
event("BufWipeout")
cached(true)
vim.cmd.bwipeout()

local autocmd_count = #vim.api.nvim_get_autocmds({ group = "LualineGitRepo" })
declaration.setup()
assert(#vim.api.nvim_get_autocmds({ group = "LualineGitRepo" }) == autocmd_count, "setup duplicated invalidators")
local expected = require("utils.git").is_git_repo()
cached(expected)
vim.fs.root = root
vim.cmd.cd(repo_root)
vim.fn.delete(temp, "rf")
print("statusline_git_cache: passed (200 conditions -> 1 discovery per invalidation)")
