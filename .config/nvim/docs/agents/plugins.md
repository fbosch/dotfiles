# Plugin Layout

Native package lifecycle code lives in `lua/config/pack/`.

Plugin categories:

- `ai/`
- `core/`
- `lang/`
- `misc/`
- `ui/`
- `workflow/`

`config.pack.discovery` loads each category before `vim.pack` installs the declared packages.

Built-in plugins disabled in `config.builtins` include netrw, tar/zip, tutor, matchit, matchparen, and others.

Native-owned declarations track an upstream branch or semver range. `nvim-pack-lock.json` records the installed revision. Review updates with:

```vim
:PackUpdate
:PackUpdate live-rename.nvim numb.nvim
```

Write the review buffer to accept updates, or quit it to discard them. Commit the generated lockfile change; do not replace declaration versions with commit hashes unless intentionally freezing a plugin.

Each plugin module returns either one native declaration or a list, so related packages remain colocated without mutating lifecycle state during module loading:

```lua
return {
	{ name = "plugin-a", src = "https://github.com/example/plugin-a.git" },
	{ name = "plugin-b", src = "https://github.com/example/plugin-b.git" },
}
```

Module evaluation may construct declaration tables and callback closures, but it must not create commands, keymaps, or autocmds or mutate editor globals. Put required pre-activation runtime work in the declaration's `init()` callback.

Discovery flattens declarations in category and filename order. Startup registers every declaration through `config.pack.inventory.register()`, installs their package specs with `vim.pack.add()`, and passes the same detached inventory snapshot to the loader. Declarations are unconditional. Put machine-specific behavior inside plugin setup or configuration rather than changing which packages exist.

A root declaration without `startup`, `events`, `commands`, `filetypes`, or `keys` loads on the scheduled post-start `User PackReady` event. Add an explicit trigger only when the plugin should load at another lifecycle point.

Use `opts = {}` for conventional `require(name).setup(opts)` initialization. Set `module` when the Lua module differs from the package name; use `setup` only for custom initialization. Omitting both means the plugin needs no setup.

Use ordered `dependencies` for runtime requirements. `init()` callbacks run once in dependency order before triggers are installed and before packages enter `runtimepath`; reserve them for boot-time globals, wrappers, or lifecycle listeners. Set `root = false` for libraries that activate only through a consumer, and `startup = true` only for packages that must load synchronously before initial buffer events. Triggered roots may use `condition(context)`; a false result leaves activation retryable. Startup roots may use a one-shot condition, while dependency-only declarations cannot be conditional. Startup and dependency-only declarations cannot also define triggers.

`:PackUpdate` updates all registered declarations, or only the names passed as arguments.

Native callback keys cannot overwrite an existing mapping unless that key explicitly sets `replace = true`. Reserve replacement for intentional overrides of known Neovim defaults.

The local loader supports only the lifecycle behavior used by this configuration. It does not implement priority ordering, generic event or filetype replay, or generic key replay. Add those capabilities only when a plugin requires them and the first-trigger behavior can be tested directly. Core loader tests cover dependency order, retryable conditions, sticky failures, and scheduled `PackReady` publication through the existing loader interface; package-specific readiness and passed-event recovery stay with their declarations.
