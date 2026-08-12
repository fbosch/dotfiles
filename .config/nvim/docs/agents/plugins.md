# Plugin Layout

Lazy.nvim setup lives in `lua/config/lazy.lua`.

Plugin categories:

- `ai/`
- `core/`
- `lang/`
- `misc/`
- `ui/`
- `workflow/`

Plugins are aggregated via `lua/plugins/init.lua` and further composed by category.

Built-in plugins disabled in `config.lazy` include netrw, tar/zip, tutor, matchit, matchparen, and others.

Native-owned declarations track an upstream branch or semver range. `nvim-pack-lock.json` records the installed revision. Review updates with:

```vim
:PackUpdate
:PackUpdate live-rename.nvim numb.nvim
```

Write the review buffer to accept updates, or quit it to discard them. Commit the generated lockfile change; do not replace declaration versions with commit hashes unless intentionally freezing a plugin.

`config.pack.registry.register()` accepts either one native declaration or a list, so related packages can remain colocated:

```lua
local register = require("config.pack.registry").register

register({
	{ name = "plugin-a", src = "https://github.com/example/plugin-a.git" },
	{ name = "plugin-b", src = "https://github.com/example/plugin-b.git" },
})
```
