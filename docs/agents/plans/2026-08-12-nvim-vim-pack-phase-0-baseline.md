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

VSCode mode was subsequently removed from the Neovim configuration. Its historical Phase 0 result remains recorded above, but it is no longer a migration acceptance target.

## Phase 1 Comparison

Phase 1 projects the existing dendritic Lazy graph into `vim.pack` rather than maintaining a duplicate central catalog. All 69 native repositories were installed at the exact Lazy-locked revisions, while a no-op native loader kept every `site/pack/core/opt` package path out of `runtimepath`. Lazy still declared 70 plugins and loaded the same eight at startup.

The repeated warm-start measurement used the same three warmups and 21 recorded launches. Its median was 146.81 ms, 32.16 ms below this baseline. The candidate range was 114.17-240.02 ms with a 35.38 ms standard deviation, so the comparison shows no Phase 1 regression but should not be treated as a stable optimization claim.

Undotree was removed after this baseline because it was no longer used. `dstein64/vim-startuptime` was subsequently restored as a native, command-loaded diagnostic, so the active migration inventory and native catalog again contain 69 application plugins.

live-rename became the first native runtime-owned key plugin in Phase 2. Fresh-process checks confirmed it was absent from Lazy and unloaded at startup, then loaded from `site/pack/core/opt` on the first `<leader>rn`. It replaced IncRename because IncRename intrinsically displayed both Neovim's command line and a mirrored Snacks widget, while live-rename provides one cursor-positioned floating editor.

Numb became the native event-loading pilot. The first `CmdlineEnter` installs its `CmdlineChanged` and `CmdlineLeave` handlers before a numeric Ex address is typed; a focused check confirmed the same first event could preview line 42.

Helpview became the native filetype-loading pilot and attaches directly to the first triggering help buffer. MiniAI became the native post-start pilot: it remains unloaded before `VimEnter`, then initializes once from the scheduled `User PackReady` event.

Nvim-toggler and Nvim-surround followed as isolated native post-start leaves. Focused checks confirmed Toggler changed `true` to `false` and Surround's `ysiw)` operator changed `word` to `(word)`.

Nvim-spider moved to native ownership on the initial `BufEnter`. Its Ex-command mappings remain active in normal, operator-pending, and visual modes to preserve dot-repeat; a focused motion check stopped `w` at the `C` in `camelCase`.

Eyeliner moved to native ownership on the default post-start lifecycle. Its `highlight_on_key` and dimming behavior, custom highlight groups, plugin commands, and `f`/`F`/`t`/`T` mappings remain unchanged.

Live Command moved to native ownership on `CmdlineEnter`. Its first trigger installs the `Norm` preview command and command-line cleanup autocmd before command text is entered. Leap remains Lazy-owned because its placeholder mappings require a safer mapping/replay design than the current callback-key loader provides.

Beacon moved to native ownership on the default post-start lifecycle. Its cursor and window autocmds, dynamic transparency behavior, and session-restoration scratch-buffer repair remain unchanged.

FTerm moved to native command ownership. Its nine commands activate the native package through `CmdUndefined`; the six normal and terminal mappings retain their original command targets and terminal-mode escape behavior.

Tint moved to native ownership on `BufWinEnter`. The `fbosch/tint.nvim` fork, scheduled setup, transforms, background tinting, and ignored highlight groups remain unchanged; Tint's own lifecycle initializes existing windows before or after `VimEnter` as needed.

Local Highlight moved to native ownership on `CursorMoved`. Unlike the prior Lazy path, native setup uses the trigger context to attach the current buffer immediately; future buffers continue attaching through the plugin's own `BufRead` autocmd.

TS Comments moved to native ownership on the default post-start lifecycle. Its empty-options setup continues overriding Neovim's `commentstring` resolution while using built-in Tree-sitter APIs only when a parser is available.

Nvim Autopairs moved to native ownership on `InsertEnter`. Its empty-options setup attaches the current buffer during the trigger, so the first inserted opening character receives its closing pair without event replay.

Vim Repeat moved to native ownership on `BufEnter` without setup. The native package path makes its `repeat#set` autoload API available before consumers register repeatable mappings; the API still initializes only on first use.

Vim Abolish moved to native ownership on `InsertEnter`. `packadd` sources the `:Abolish` command before custom setup installs all typo rules, so abbreviations apply during the first insert session.

Which Key moved to native ownership with explicit scheduled `PackReady` and `<leader>wk` triggers. The command path remains available immediately after setup, while the plugin's own scheduler completes mapping-state initialization after `VimEnter`.

`tsc.nvim` was removed rather than migrated. The configured `tsgo` language server already provides TypeScript diagnostics, TSC had no key mappings, watch mode was disabled, and two declared command triggers no longer existed in the installed plugin. Its TSC-specific Trouble quickfix hook was removed with it, reducing the active application catalog to 68.

Nvim JQX moved to native ownership on JSON/YAML `FileType` and `BufWritePost`. Its runtime script defines the query commands on activation and does not require trigger replay or setup.

Treewalker moved to native command and callback-key ownership. Its six active mappings retain their modes and actions; it uses Neovim's built-in Tree-sitter APIs and does not require native ownership of `nvim-treesitter`.

Conform moved to native ownership across its 14 filetype triggers. Its existing formatter configuration and both existing `BufWritePre` handlers remain unchanged and are installed before the first subsequent save.

Nvim Scrollbar moved to native ownership on the default post-start lifecycle. Its excluded buffer types and handle color remain unchanged; the initial existing buffer renders on the next cursor, scroll, text, diagnostic, or window event, matching its previous `VeryLazy` setup.

Nvim TS Autotag moved to native ownership on `BufReadPre` and `BufNewFile`. Lazy still startup-owns `nvim-treesitter`; Autotag's native setup installs its modern handlers before the first later `FileType` or `InsertEnter`.

Indent Blankline moved to native ownership on `BufReadPost` and `BufNewFile`. Its TTY-sensitive glyphs and custom highlights remain unchanged, and `ibl.setup()` refreshes visible buffers immediately without event replay.

CCC moved to native ownership across its configured filetypes, commands, and `<leader>pc` callback key. Its setup continues wrapping highlighter failures and explicitly attaches the first triggering buffer before the plugin's own `BufEnter` handler covers later eligible buffers.

Direct file-argument validation exposed that Lazy's runtime conditions removed disabled plugins from the transitional native install projection. The projection now includes Lazy's resolved disabled specs so conditions affect activation without changing the 68-plugin installation catalog.

Phase 5 moved the complete Treesitter and Plenary ownership closure to native packages. The loader now validates dependency graphs, activates ordered dependencies before consumers, supports synchronous startup roots, retries false command/key conditions, and records lifecycle failures with their root, chain, plugin, and phase. Treesitter and Plenary load synchronously; Plenary remains startup-loaded for the still-Lazy `nvim-lsp-file-operations` consumer until Phase 6.

Focused fresh-process checks covered the initial Treesitter/Hlargs Lua buffer, Autotag with native Treesitter, the initial Checkmate todo buffer, Treesj's first key and direct command, Todo Comments post-start setup, Coverage's first command and callback key, Neotest dependency ordering/configuration/key action, Diffview's non-Git-to-Git condition retry, and Gitlineage's first visual history action. Native ownership increased from 26 to 38 while the application catalog remained 68.

The required Phase 5 Hyperfine checkpoint used the unchanged command, three warmups, and 21 recorded launches. Mean startup was 46.9 ms with a 1.3 ms standard deviation and a 44.6-50.0 ms range. This is 4.8 ms below the preceding 51.7 ms migration-wave mean, 116.71 ms below the 163.61 ms post-pilot median, and 132.07 ms below the 178.97 ms Phase 0 median; synchronous native Treesitter and Plenary introduced no measured startup regression.

## Post-Pilot Performance Checkpoint

After migrating live-rename, Numb, Helpview, and MiniAI, and restoring `dstein64/vim-startuptime`, the repeated warm-start measurement used the original command, three warmups, and 21 recorded launches:

```bash
hyperfine --warmup 3 --runs 21 \
  'nvim --headless -i NONE "+qa"'
```

| Metric | Post-pilot checkpoint | Change from Phase 0 |
| --- | ---: | ---: |
| Wall time median | 163.61 ms | -15.36 ms |
| Wall time mean | 169.48 ms | -11.01 ms |
| Standard deviation | 16.40 ms | -14.41 ms |
| Wall time range | 150.45-210.52 ms | narrower |
| Mean user CPU | 36.97 ms | +1.23 ms |
| Mean system CPU | 41.99 ms | +2.65 ms |
| Peak RSS median | 16.98 MiB | +0.15 MiB |
| Samples | 21 successful, 0 failed | unchanged |

The median remains 8.6% below the Phase 0 baseline, so the pilot migrations show no startup regression. This checkpoint supersedes the Phase 1 measurement for comparisons during the remaining migration.

The restored `:StartupTime` command loads only on first invocation and defaults to 10 samples. This command captures a machine-readable initialization profile without adding the profiler itself to normal startup:

```vim
:StartupTime --tries 10 --save vim_pack_startup --hidden
```

The 10-launch initialization profile reported a 122.05 ms mean with a 31.78 ms standard deviation. Largest profiler attributions were:

| Initialization source | Attributed exclusive mean | Attributed inclusive mean |
| --- | ---: | ---: |
| `require('config.lazy')` | 38.06 ms | 85.19 ms |
| `require('fbb.palette')` | 13.30 ms | 13.30 ms |
| `require('config.pack')` | 2.48 ms | 5.22 ms |
| `require('config.hls')` | 0.99 ms | 20.47 ms |
| `require('config.colors')` | 0.89 ms | 14.20 ms |

The `fbb.palette` attribution is not its actual execution cost. A 30-sample follow-up still attributed 12.07 ms to it, but direct fresh-process instrumentation measured about 1.3 ms for module lookup, file read, JSON decode, and palette extraction. The file read itself took about 0.14 ms and JSON decoding about 0.02 ms. A minimal `--startuptime` launch attributed 1.44 ms exclusively to the same `require`. In the full trace, an unreported gap after sourcing the colorscheme is charged to the next recorded Lua event, which is `require('fbb.palette')`.

Use the Hyperfine median as the regression gate and `:StartupTime` as a diagnostic lead, not proof of exclusive execution cost. Future checkpoints must use both commands unchanged, compare exclusive and inclusive attributions, and confirm suspicious entries with direct instrumentation before optimizing them.
