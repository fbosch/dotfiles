# Neovim `vim.pack` Migration Plan

This plan moves `.config/nvim` from Lazy.nvim to Neovim's built-in `vim.pack` API while preserving package-level lazy-loading behavior. The migration is incremental: Lazy.nvim and `vim.pack` coexist until native ownership covers every active plugin.

## Terminology And Scope

- The native target is `vim.pack`, available in Neovim 0.12.4. There is no native `vim.plug` API.
- `vim-plug` is a separate third-party manager and is not part of this migration.
- The minimum supported editor version is Neovim 0.12.4.
- Zenbones continues to load in vscode-neovim, matching the current configuration.
- The current package-level lazy-loading behavior is preserved rather than replaced with eager startup loading.
- The recently removed Incline, StartupTime, Typr, and Volt plugins remain removed.
- `lazy-lock.json` is generated state. Do not hand-edit or transform it.
- Freeze plugin updates while both managers coexist, so the two lockfiles do not diverge.

Official references:

- [Neovim 0.12.4 `vim.pack` documentation](https://github.com/neovim/neovim/blob/v0.12.4/runtime/doc/pack.txt)
- [Current Neovim package documentation](https://neovim.io/doc/user/pack/)
- [`vim-plug` documentation](https://github.com/junegunn/vim-plug)

## Migration Contract

`vim.pack` manages repositories, revisions, installation, updates, and deletion. It does not replace Lazy.nvim's trigger system. A small local activation layer supplies the behavior this configuration uses:

```text
vim.pack
  -> repository lifecycle and native lockfile

local activation layer
  -> dependency ordering
  -> packadd-once activation
  -> event and FileType replay
  -> CmdUndefined triggers
  -> proxy keymaps
  -> init and setup phases
  -> priority and condition handling
  -> PackChanged build hooks
```

Native-owned declarations follow upstream branches or semver ranges. Reproducibility comes from the generated `nvim-pack-lock.json`; commit hashes in declarations are reserved for intentional freezes.

Use `:PackUpdate` to review every native update or pass plugin names for a focused review. Write the review buffer to accept changes and regenerate the lockfile; quit it to discard them.

The coexistence rule is strict: a plugin is installed and activated by one manager at a time. A plugin may exist in both managers' data directories during a rollback window, but its second copy must not be added to `runtimepath`.

```text
~/.local/share/nvim/lazy/
  -> plugins still owned by Lazy.nvim

~/.local/share/nvim/site/pack/core/opt/
  -> plugins migrated to vim.pack
```

The current Lazy setup resets `packpath` and `runtimepath` in `.config/nvim/lua/config/lazy.lua`. Hybrid operation must retain Neovim's standard `site` path and activate native packages only after Lazy has completed its runtime-path reset.

## Target Layout

Create these modules during the foundation phase:

```text
.config/nvim/lua/config/pack/
  init.lua       # version guard, native registration, startup entry point
  specs.lua      # transitional projection of the colocated plugin graph
  loader.lua     # native activation and trigger implementations
  build.lua      # PackChanged build hooks
.config/nvim/nvim-pack-lock.json
```

Keep package definitions and behavior organized together by category under `.config/nvim/lua/plugins/`. Phase 1 projects the resolved Lazy graph into native specs so it does not duplicate a central package catalog. As each plugin moves, replace its Lazy spec in place with a manager-independent activation declaration.

The local declaration format should remain narrow and cover only the features used here:

```lua
{
  name = "plugin-name",
  src = "https://github.com/owner/repository",
  version = "...",
  dependencies = { ... },
  priority = 1000,
  condition = function() end,
  init = function() end,
  setup = function() end,
  triggers = {
    events = { ... },
    commands = { ... },
    filetypes = { ... },
    keys = { ... },
  },
}
```

Do not recreate the full Lazy.nvim specification API. A smaller, explicit contract keeps the native loader understandable and bounded.

## Loader Guarantees

The native loader must guarantee all of the following before broad plugin migration begins:

- `init` runs before the plugin's runtime scripts when the plugin relies on early globals.
- Dependencies activate before their consumer.
- Each plugin is added to `runtimepath` at most once.
- Each plugin's setup runs at most once.
- `CmdUndefined` loads the plugin and retries the original command.
- Key proxies remove themselves, load the plugin, and replay the original key without losing mode, count, register, operator, or visual selection context.
- Event and filetype triggers replay the current event under a recursion guard when a plugin would otherwise miss its first trigger.
- Conditions gate activation without making installation state nondeterministic.
- Explicit priority controls replace Lazy.nvim priority sorting.
- Errors identify the plugin, lifecycle phase, and dependency chain.
- A scheduled post-`VimEnter` `User PackReady` event replaces `User VeryLazy` for migrated plugins.

## Dependency Boundaries

Migrate shared dependencies with all of their active consumers. The major ownership closures are:

```text
LuaSnip -> blink.cmp -> nvim-lspconfig
nvim-lsp-file-operations -> nvim-lspconfig and nvim-tree
nvim-treesitter -> nvim-ts-autotag, treesj, hlargs, checkmate, neotest
plenary.nvim -> todo-comments, diffview, coverage, neotest
nvim-web-devicons -> barbar, lualine, trouble, wilder
tiny-devicons-auto-colors -> nvim-web-devicons setup
bufresize -> smart-splits
fzy-lua-native -> wilder
nvim-notify -> nvim-recorder and fidget
snacks -> opencode
diffview -> gitlineage
nvim-nio and neotest-vitest -> neotest
```

Do not move a shared dependency alone while Lazy.nvim still owns a consumer that declares it. That creates duplicate copies and nondeterministic module resolution.

## Phase 0: Record The Baseline

**Purpose:** Capture the current behavior and performance before changing package ownership.

Record:

- Neovim version and `vim.pack` availability.
- The 69 active plugin repositories.
- Current `runtimepath` and Lazy package paths.
- Startup-time results from several launches.
- Commands and mappings from representative plugins.
- First-trigger behavior for insert, filetype, command line, LSP, recording, and second-buffer activation.
- Normal startup, headless startup, vscode-neovim behavior, and session restoration.

Commands:

```bash
nvim --version
nvim --startuptime /tmp/nvim-lazy-startup.log
nvim -i NONE --headless '+qa'
devenv test test:lua-quality
devenv test
```

**Acceptance:** The baseline is sufficient to compare functionality and startup timing after every major phase.

**Rollback:** None. This phase does not change behavior.

## Phase 1: Establish Native Lifecycle Without Activation

**Purpose:** Install and lock the native catalog while Lazy.nvim remains the only runtime loader.

Changes:

- Add a Neovim `>= 0.12.4` guard and verify `vim.pack` is available.
- Project the existing dendritic plugin graph into pinned native specs without duplicating a central catalog.
- Register each repository with `vim.pack.add(..., { load = function() end })`.
- Run native registration after Lazy setup so Lazy cannot remove the standard native package path.
- Retain the standard `site` directory in `packpath` during hybrid operation.
- Register `PackChanged` hooks before the first `vim.pack.add()` call.
- Use each active plugin's current Lazy commit temporarily as its native revision.
- Let `vim.pack` generate `.config/nvim/nvim-pack-lock.json`.

Build hooks:

- `nvim-treesitter`: update parsers in an isolated child Neovim after install or update.
- `fff.nvim`: run its binary download/build in an isolated child Neovim after install or update.

**Acceptance:** `vim.pack.get()` reports every registered native package at the pinned revision, no native plugin path is in `runtimepath`, and Lazy remains the only runtime owner. Native registrations report `active = true`; runtime-path isolation is the actual shadow-install invariant.

**Rollback:** Stop requiring the native bootstrap. Lazy.nvim remains unchanged.

## Phase 2: Validate Native Key Loading With Live Rename

**Purpose:** Prove native ownership, command loading, proxy keymaps, early globals, and setup-once behavior with an isolated plugin.

Pilot plugin:

```text
saecki/live-rename.nvim
```

Changes:

- Add `loader.lua` with `packadd`-once, setup-once, and proxy-key support.
- Register live-rename beside its key and setup in `plugins/core/editing.lua`.
- Preserve `<leader>rn` while replacing IncRename's duplicated command-line/Snacks UI with one cursor-positioned floating editor.

**Acceptance:** `<leader>rn` loads the native copy on first use and opens one cursor-positioned floating rename editor. The native copy is the only active copy in `runtimepath`.

**Rollback:** Remove the live-rename native declaration and restore the previous rename mapping.

**Outcome:** live-rename is the first native-owned key-triggered plugin. Its declaration, source, pinned migration revision, setup, and key behavior remain colocated in `plugins/core/editing.lua`. The native loader activates it once through the key proxy; Lazy does not include it in its graph.

## Phase 3: Prove Each Trigger Type

**Purpose:** Validate all trigger primitives before migrating dependency clusters.

| Trigger | Pilot | Required behavior |
| --- | --- | --- |
| Key | live-rename | The proxy loads the plugin and invokes its rename action. |
| Event | `nacro90/numb.nvim` | The first `CmdlineEnter` installs preview handlers before any address is typed. |
| Filetype | `OXY2DEV/helpview.nvim` | The first help buffer receives filetype behavior. |
| Post-start | `echasnovski/mini.ai` | Scheduled post-`VimEnter` setup replaces `VeryLazy`. |
| Condition | A Git-only plugin | Activation happens only in a Git repository. |
| Build | `dmtrKovalenko/fff.nvim` | Install or update builds the required binary and fails clearly. |

Add event replay, FileType replay, recursion guards, priority ordering, condition evaluation, and `User PackReady` in this phase.

**Acceptance:** Every pilot works on its first trigger in a fresh process. Repeated triggers do not create duplicate mappings, setup calls, or autocmds. Lazy continues managing all unmigrated plugins.

**Rollback:** Restore the relevant pilot plugin to Lazy ownership.

## Phase 4: Migrate Isolated Leaf Plugins

**Purpose:** Exercise the loader with low-dependency plugins before moving shared infrastructure.

Candidate vertical slices:

- `mini.ai`
- `numb.nvim`
- `helpview.nvim`
- `nvim-toggler`
- `nvim-spider`
- `nvim-surround`
- `inc-rename.nvim`
- `eyeliner.nvim`
- `leap.nvim`
- `FTerm.nvim`
- `beacon.nvim`
- `local-highlight.nvim`
- `tint.nvim`
- `live-command.nvim`

Each slice must remove the Lazy declaration, add the native declaration, preserve configuration and triggers, validate first use, and confirm that only one copy is active.

**Acceptance:** Every migrated plugin remains inactive until its original trigger and continues to work on first use.

**Rollback:** Revert the individual plugin's ownership slice.

## Phase 5: Migrate Treesitter, Testing, And Plenary

**Purpose:** Move shared syntax and test dependencies as complete ownership closures.

Cluster:

```text
nvim-treesitter
nvim-ts-autotag
hlargs
checkmate
plenary.nvim
neotest
nvim-nio
neotest-vitest
nvim-coverage
```

Requirements:

- Treesitter remains startup-loaded where current behavior requires it.
- Parser installation and the `:TSUpdate` build hook remain operational.
- Filetype-triggered plugins work for the first opened source and Markdown buffer.
- Neotest remains key-triggered with its adapters available first.
- Diffview, Gitlineage, Coverage, and Todo Comments retain their commands and mappings.

**Acceptance:** Exactly one Treesitter and Plenary copy is active. Parsers resolve, Checkmate works in the initial Markdown todo buffer, Neotest actions work, and Git workflows work within a repository.

**Rollback:** Revert this complete cluster because its dependency edges cross the named plugins.

## Phase 6: Migrate Completion, LSP, And Explorer

**Purpose:** Preserve first-buffer and first-insert ordering for language tooling.

Cluster:

```text
LuaSnip
blink.cmp
nvim-lspconfig
lazydev.nvim
nvim-lsp-file-operations
lspsaga.nvim
nvim-tree.lua
```

Required ordering:

```text
LuaSnip
  -> Blink setup
    -> Blink LSP capabilities
      -> LSPConfig
        -> LSP attachment
```

`nvim-lsp-file-operations` must load before both LSP capability setup and NvimTree file operations.

**Acceptance:** Completion works on the first insert, snippets expand, LSP clients attach once with Blink capabilities, Lua workspace completion works, Saga works on first attachment, and NvimTree rename and move operations notify language servers.

**Rollback:** Revert the complete cluster. Mixed ownership of LSP capability providers is unsafe.

## Phase 7: Migrate Shared UI, Diagnostics, And Git Infrastructure

**Purpose:** Move high-fan-out UI dependencies with their consumers.

Subclusters:

```text
nvim-web-devicons
barbar.nvim
lualine.nvim
trouble.nvim
wilder.nvim
fzy-lua-native
```

```text
nvim-notify
nvim-recorder
fidget.nvim
```

```text
bufresize.nvim
smart-splits.nvim
```

```text
gitsigns.nvim
git-conflict.nvim
diffview.nvim
gitlineage.nvim
```

Special handling:

- Replace Barbar's direct `require("lazy").load()` with local setup-once activation when a second listed file buffer appears.
- Preserve the first command-line behavior for Wilder.
- Preserve the first `RecordingEnter` behavior for Recorder.
- Preserve Fidget notification routing.
- Preserve Git-repository conditions and first-buffer Gitsigns attachment.
- Ensure Lualine tolerates integrations that remain lazily unloaded.

**Acceptance:** Wilder works on the first command-line interaction, Recorder works for the first macro, Barbar activates once on the second listed file, Git plugins remain inactive outside repositories, and Trouble/Lualine retain their integrations.

**Rollback:** Revert each subcluster as one unit.

## Phase 8: Migrate Sessions, AI, Terminals, And Remaining Workflows

**Purpose:** Move lifecycle-heavy plugins after their dependencies and loader semantics are proven.

Cluster candidates:

```text
mini.sessions
snacks.nvim
opencode.nvim
fff.nvim
FTerm.nvim
conform.nvim
tsc.nvim
nvim-jqx
which-key.nvim
nvim-scrollbar
indent-blankline.nvim
ccc.nvim
```

Requirements:

- mini.sessions remains available before `VimEnter`.
- Snacks' `vim.ui.input` and `vim.ui.select` wrappers remain available before consumers invoke them.
- Snacks activates before opencode requires `snacks.terminal`.
- Opencode's early environment and session autocmds remain boot-time behavior, while its main setup stays key-triggered.
- FTerm custom commands remain first-use compatible.
- fff remains key-triggered and has its built binary.
- Conform formats on the first eligible save.
- TypeScript and JSON/YAML integrations work on the first matching filetype.

**Acceptance:** Sessions restore and save once, Opencode lifecycle behavior works, FTerm and fff work on first use, first-save formatting works, and TypeScript/JSON/YAML behavior matches the baseline.

**Rollback:** Revert lifecycle integration slices individually unless they share a hard dependency such as Snacks and Opencode.

## Phase 9: Make Native Ownership The Default

**Purpose:** End hybrid application-plugin ownership while retaining a short rollback window.

Changes:

- Move every remaining active plugin to the native catalog and loader.
- Stop passing application plugin specs to Lazy.nvim.
- Replace remaining `User VeryLazy` consumers with `User PackReady`.
- Keep Lazy's bootstrap and installation unchanged but dormant for one release window.

**Acceptance:** No application plugin path comes from `stdpath("data") .. "/lazy"`. Every plugin has a single native activation declaration. Normal, headless, and VSCode startup pass. Compare startup timing with Phase 0.

**Rollback:** Restore the last hybrid ownership commit while the Lazy installation remains present.

## Phase 10: Remove Lazy.nvim

**Purpose:** Remove Lazy only after native behavior has been accepted.

Delete or update:

```text
.config/nvim/lua/config/lazy.lua
.config/nvim/README.md
.config/nvim/AGENTS.md
.config/nvim/docs/agents/plugins.md
.config/nvim/docs/agents/behavior.md
.config/nvim/docs/buffer-plugins.md
```

Generated-state handling:

- Do not manually edit `lazy-lock.json`.
- Keep the lockfile and old Lazy data directory for the agreed rollback window.
- Remove them only in a separate, explicitly approved cleanup.
- Use `vim.pack.del()` for native package deletion rather than deleting native package directories directly.

**Acceptance:** `:Lazy` does not exist, `package.loaded.lazy` is `nil`, and no Lazy module resolves through `runtimepath`.

## Validation Gates

Run after each individual plugin slice:

```bash
nvim -i NONE --headless '+qa'
```

Run after each shared-dependency cluster:

```bash
devenv test
nvim -i NONE --headless '+checkhealth' '+qa'
```

Use isolated XDG state at major phase boundaries:

```bash
tmp="$(mktemp -d)"
XDG_CONFIG_HOME="$PWD/.config" \
XDG_DATA_HOME="$tmp/data" \
XDG_STATE_HOME="$tmp/state" \
XDG_CACHE_HOME="$tmp/cache" \
nvim -i NONE --headless '+qa'
```

On Neovim 0.12.4, headless confirmation accepts the default `Yes`. This command intentionally installs the locked native catalog into the isolated data directory; there is no native `NVIM_PACK_CONFIRM` environment variable.

Validate VSCode-mode gating:

```bash
nvim -i NONE --headless --cmd 'let g:vscode = 1' '+qa'
```

Compare startup performance at Phases 5, 7, and 9:

```bash
nvim --startuptime /tmp/nvim-native-startup.log
```

Check runtime ownership while both systems coexist:

```vim
:lua vim.print(vim.api.nvim_list_runtime_paths())
:lua vim.print(vim.pack.get())
:verbose command IncRename
```

Check that Lazy is fully removed only after Phase 10:

```bash
rg -n \
  'lazy\.nvim|require\(["'"'"']lazy["'"'"']\)|VeryLazy|:Lazy|config\.lazy|/lazy/lazy\.nvim' \
  .config/nvim \
  --glob '!lazy-lock.json'
```

```vim
:lua print(vim.fn.exists(":Lazy"))
:lua print(package.loaded.lazy)
:lua vim.print(vim.api.nvim_get_runtime_file("lua/lazy/init.lua", true))
```

Expected after Phase 10:

```text
:Lazy command: absent
package.loaded.lazy: nil
lua/lazy/init.lua runtime files: none
```
