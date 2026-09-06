local repo_root = assert(vim.env.REPO_ROOT)
local session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
local cwd = vim.uv.fs_realpath(repo_root) or vim.fs.normalize(repo_root)

local default = session.resolve(cwd, "default")
local herdr = session.resolve(cwd, "herdr-w1-p1")
local managed = session.resolve(cwd, "workspace")

vim.fn.mkdir(session.get_root_dir(), "p")
vim.fn.writefile({ "let g:session_selection_fixture = 1" }, default.path)
vim.fn.writefile({ "let g:session_selection_fixture = 1" }, herdr.path)
vim.fn.writefile({ "let g:session_selection_fixture = 1" }, managed.path)
session.set_metadata({ last_used_at = 100, pi_terminal_open = true, pi_session_id = "pi-default" }, default)
session.set_metadata({ last_used_at = 200 }, herdr)
session.set_metadata({ last_used_at = 300, herdr_managed = true }, managed)

vim.env.HERDR_ENV = nil
vim.env.HERDR_PANE_ID = nil
vim.env.NVIM_SESSION = nil
local selected, explicit = session.resolve_requested(cwd)
assert(selected.specifier == "default", "normal startup selected a Herdr-managed session")
assert(explicit == false, "normal startup selection was unexpectedly explicit")

vim.env.NVIM_SESSION = "herdr-w1-p1"
selected, explicit = session.resolve_requested(cwd)
assert(selected.specifier == "herdr-w1-p1", "explicit Herdr session was not preserved")
assert(explicit == true, "explicit Herdr session lost its explicit marker")

vim.env.HERDR_ENV = "1"
vim.env.HERDR_PANE_ID = "w9:p9"
selected, explicit = session.resolve_requested(cwd)
assert(selected.specifier == "herdr-w9-p9", "active Herdr session was not selected")
assert(explicit == true, "active Herdr session lost its explicit marker")

vim.fn.delete(session.get_root_dir(), "rf")
vim.cmd("qa!")
