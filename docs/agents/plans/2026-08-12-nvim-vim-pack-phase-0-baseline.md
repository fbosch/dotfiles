# Neovim `vim.pack` Migration Phase 0 Baseline

This report records the Lazy.nvim baseline before any plugin moves to `vim.pack`. Measurements were taken on 2026-08-12 from `/Users/fbb/dotfiles` with the existing plugin installation and caches intact.

## Environment

| Property | Baseline |
| --- | --- |
| Neovim | 0.12.4, release build |
| Lua runtime | LuaJIT 2.1.1774638290 |
| Platform | macOS/Darwin |
| `vim.pack` | Available as a table |
| `vim.plug` | Absent (`nil`) |
| `:Lazy` | Present (`exists()` returned 2) |
| Package state | Existing Lazy installation and warm caches |

The target API is therefore `vim.pack`, not `vim.plug`. The installed Neovim version satisfies the migration's 0.12.4 minimum.

## Plugin Inventory

Lazy.nvim reports 70 declarations: Lazy itself and 69 application plugin repositories.

The eight plugins loaded at startup are:

```text
lazy.nvim
mini.sessions
nvim-spider
nvim-treesitter
tint.nvim
transparent.nvim
vim-repeat
zenbones.nvim
```

The 69 application plugin declarations are:

```text
FTerm.nvim
LuaSnip
barbar.nvim
beacon.nvim
blink.cmp
bufresize.nvim
ccc.nvim
checkmate.nvim
conform.nvim
diffview.nvim
eyeliner.nvim
fff.nvim
fidget.nvim
fzy-lua-native
git-conflict.nvim
gitlineage.nvim
gitsigns.nvim
helpview.nvim
hlargs.nvim
inc-rename.nvim
indent-blankline.nvim
lazydev.nvim
leap.nvim
live-command.nvim
local-highlight.nvim
lspsaga.nvim
lualine.nvim
matchparen.nvim
mini.ai
mini.sessions
neotest
neotest-vitest
numb.nvim
nvim-autopairs
nvim-coverage
nvim-jqx
nvim-lsp-file-operations
nvim-lspconfig
nvim-nio
nvim-notify
nvim-recorder
nvim-scrollbar
nvim-spider
nvim-surround
nvim-toggler
nvim-tree.lua
nvim-treesitter
nvim-ts-autotag
nvim-web-devicons
opencode.nvim
plenary.nvim
smart-splits.nvim
snacks.nvim
tint.nvim
tiny-devicons-auto-colors.nvim
todo-comments.nvim
transparent.nvim
treesj
treewalker.nvim
trouble.nvim
ts-comments.nvim
tsc.nvim
undotree
vim-abolish
vim-repeat
vim-unimpaired
which-key.nvim
wilder.nvim
zenbones.nvim
```

Incline, both StartupTime implementations, Typr, and Volt are absent from active declarations and remain outside the migration inventory.

## Runtime Ownership

No native package path under `site/pack` is active. The startup runtime paths owned by Lazy are:

```text
~/.local/share/nvim/lazy/lazy.nvim
~/.local/share/nvim/lazy/vim-repeat
~/.local/share/nvim/lazy/nvim-spider
~/.local/share/nvim/lazy/tint.nvim
~/.local/share/nvim/lazy/nvim-treesitter
~/.local/share/nvim/lazy/mini.sessions
~/.local/share/nvim/lazy/transparent.nvim
~/.local/share/nvim/lazy/zenbones.nvim
~/.local/state/nvim/lazy/readme
```

Phase 1 must preserve this outcome until native packages are explicitly assigned runtime ownership. Shadow packages are registered as active by `vim.pack`, but registration must not add a `site/pack/core/opt` plugin path to `runtimepath`.

## Startup Performance

Warm-start process timing used three unrecorded warmups followed by 21 recorded launches:

```bash
hyperfine --warmup 3 --runs 21 \
  'nvim --headless -i NONE "+qa"'
```

`-i NONE` disables ShaDa history. No install, update, clean, or sync command ran during measurement.

| Metric | Baseline |
| --- | ---: |
| Wall time median | 178.97 ms |
| Wall time mean | 180.49 ms |
| Standard deviation | 30.81 ms |
| Wall time range | 110.90-240.54 ms |
| Central 50% | 169.34-200.69 ms |
| Mean user CPU | 35.74 ms |
| Mean system CPU | 39.34 ms |
| Mean total CPU | 75.08 ms |
| Peak RSS median | 16.83 MiB |
| Peak RSS range | 16.61-16.83 MiB |
| Samples | 21 successful, 0 failed |

Tukey's 1.5 IQR rule marks 110.90 ms and 121.84 ms as low outliers. No high-side outlier was detected.

A separate `--startuptime` diagnostic launch reached `--- NVIM STARTED ---` at 163.394 ms. That single launch is diagnostic evidence, not the comparison statistic. Use the 178.97 ms median for migration comparisons.

Lazy's internal startup statistics were:

| Lazy statistic | Baseline |
| --- | ---: |
| Declared plugins | 70 |
| Loaded at startup | 8 |
| `LazyStart` | 29.406 ms |
| `LazyDone` | 65.617 ms |
| Real CPU timing | Enabled |

## Lazy Trigger Baseline

The migration pilots were confirmed unloaded immediately after startup:

| Plugin | Current trigger | Loaded at initial check |
| --- | --- | --- |
| Undotree | Commands plus one key proxy | No |
| `numb.nvim` | `CmdLineEnter` | No |
| `helpview.nvim` | `help` filetype | No |
| `mini.ai` | `VeryLazy` | No |
| `fff.nvim` | Three key mappings | No |

Focused first-trigger checks passed:

| Behavior | Result |
| --- | --- |
| Execute `:UndotreeToggle` | Undotree changed from unloaded to loaded on the first command. |
| Execute `CmdlineEnter` for `:` | `numb.nvim` changed from unloaded to loaded on the first event. |
| Open `:help help` | `helpview.nvim` changed from unloaded to loaded in the first `help` buffer. |
| Execute `User VeryLazy` | `mini.ai` changed from unloaded to loaded on the first event. |

These checks establish loader activation, not full interactive UI parity. Key replay semantics, visual ranges, operator-pending behavior, real LSP attachment, session restoration, and terminal UI behavior still require interactive checks during their migration slices.

## Validation Results

| Check | Result |
| --- | --- |
| `nvim -i NONE --headless '+qa'` | Passed with no output. |
| `nvim -i NONE --headless '+checkhealth' '+qa'` | Completed all reported health groups. |
| `devenv tasks run test:lua` | Passed. |
| `devenv tasks run test:lua-quality` | Initially timed out; passed after the follow-up fix below. |
| Full `devenv test` | Initially exposed runtime fixture portability and synchronization failures; passed after the follow-up fixes below. |
| Headless `g:vscode = 1` approximation | Not valid outside vscode-neovim; `config/vscode.lua` requires the host-provided `vscode` module. |

The Lua-quality task reached this command and remained there until terminated:

```text
lua-language-server --check=/Users/fbb/dotfiles --checklevel=Error --check_format=pretty
```

It produced no error diagnostics before either timeout. The follow-up fix below bounds the scan and restores this gate.

The headless VSCode approximation failed because the standalone process cannot provide vscode-neovim's `vscode` Lua module. Validate VSCode behavior in the real host when a phase changes category gating or colorscheme ownership.

## Comparison Gates

Use these thresholds and invariants after migration phases:

- Compare warm startup against the 178.97 ms median with the same command, three warmups, and at least 21 samples.
- Keep exactly eight startup-loaded plugins until a phase intentionally changes startup ownership or timing.
- Require one active runtime path per plugin while Lazy and `vim.pack` coexist.
- Require first-trigger success in a fresh process for every migrated command, event, filetype, and key path.
- Preserve the current active application-plugin inventory unless a separate cleanup explicitly changes it.
- Treat native paths appearing before Phase 1 activation as an ownership failure.
- Do not claim VSCode parity from a standalone headless simulation.

## Phase 0 Outcome

Phase 0 is complete with one Neovim-specific validation limitation: VSCode behavior requires its real host. The plugin inventory, runtime ownership, warm-start performance, normal headless startup, health checks, Lua quality, and representative Lazy trigger behavior are established well enough to begin Phase 1.

## Follow-Up

The Lua-quality timeout was traced to repository-wide LuaLS indexing of large generated dependency trees. `scripts/lua-quality.sh` now checks the five tracked Lua roots independently with a 120-second limit per root. Devenv exposes these as `test:lua-quality:fbb`, `test:lua-quality:hyprland`, `test:lua-quality:neovim`, `test:lua-quality:wezterm`, and `test:lua-quality:keybinds`; `test:lua-quality` remains the aggregate gate. This preserves diagnostics for all tracked Lua sources while excluding unrelated generated content.

The subsequent full gate exposed runtime fixture races and Linux-only process assumptions. The lifecycle fixture now waits for background launcher logs, the gaming fixture waits for observable transitions, Linux `/proc` and `/dev/full` probes skip on macOS, and the comprehensive Profilectl fixture has a 60-second per-file budget. `test:runtime-shell` and the full `devenv test` gate now pass.

## Phase 1 Comparison

Phase 1 projects the existing dendritic Lazy graph into `vim.pack` rather than maintaining a duplicate central catalog. All 69 native repositories were installed at the exact Lazy-locked revisions, while a no-op native loader kept every `site/pack/core/opt` package path out of `runtimepath`. Lazy still declared 70 plugins and loaded the same eight at startup.

The repeated warm-start measurement used the same three warmups and 21 recorded launches. Its median was 146.81 ms, 32.16 ms below this baseline. The candidate range was 114.17-240.02 ms with a 35.38 ms standard deviation, so the comparison shows no Phase 1 regression but should not be treated as a stable optimization claim.

Undotree was removed after this baseline because it was no longer used. The active migration inventory and native shadow set now contain 68 application plugins.

IncRename became the first native runtime-owned plugin in Phase 2. Fresh-process checks confirmed it was absent from Lazy and unloaded at startup, then loaded from `site/pack/core/opt` on the first `:IncRename` command or `<leader>rn` key callback. The key retained its editable `:IncRename <current-word>` expansion.
