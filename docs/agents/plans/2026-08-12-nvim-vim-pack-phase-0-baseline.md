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

Phase 5 moved the complete Treesitter and Plenary ownership closure to native packages. The loader now validates dependency graphs, activates ordered dependencies before consumers, supports synchronous startup roots, retries false command/key conditions, and records lifecycle failures with their root, chain, plugin, and phase. Treesitter and Plenary initially loaded synchronously because the still-Lazy `nvim-lsp-file-operations` consumer did not declare its Plenary requirement; Phase 6 later made that edge explicit and returned Plenary to dependency-only activation.

Focused fresh-process checks covered the initial Treesitter/Hlargs Lua buffer, Autotag with native Treesitter, the initial Checkmate todo buffer, Treesj's first key and direct command, Todo Comments post-start setup, Coverage's first command and callback key, Neotest dependency ordering/configuration/key action, Diffview's non-Git-to-Git condition retry, and Gitlineage's first visual history action. Native ownership increased from 26 to 38 while the application catalog remained 68.

The required Phase 5 Hyperfine checkpoint used the unchanged command, three warmups, and 21 recorded launches. Mean startup was 46.9 ms with a 1.3 ms standard deviation and a 44.6-50.0 ms range. This is 4.8 ms below the preceding 51.7 ms migration-wave mean, 116.71 ms below the 163.61 ms post-pilot median, and 132.07 ms below the 178.97 ms Phase 0 median; synchronous native Treesitter and Plenary introduced no measured startup regression.

Phase 6 moved LuaSnip, Blink, LSPConfig, LazyDev, LSP file operations, Lspsaga, and NvimTree to native ownership. Plenary returned to dependency-only activation once file operations declared the implicit edge. Focused checks covered the first-insert Blink/LuaSnip closure, initial source-file LSP capabilities, explicit LazyDev Lua workspace roots and native package discovery, Saga setup before first attachment, NvimTree command/key activation, and file-operation event subscriptions. Native ownership increased from 38 to 45 while the catalog remained 68.

FFF moved to native callback-key ownership after its Lazy checkout advanced without the required Rust backend binary. The initial picker import failed in `fff.fuzzy`; Lua's failed-load sentinel then made later attempts report a previous-load loop. The native copy retained revision `d4c416c2fcf24eeda40a540a898da12824aed18f`, included a working `libfff_nvim.so`, and passed direct picker loading plus first `<C-p>` open/close behavior. Native ownership increased to 46; future binaries are maintained by the isolated native build hook.

Phase 7 began with Bufresize and Smart Splits as one native dependency slice. Fresh-process checks covered first command and callback-key activation, all four resize commands and mappings, Bufresize's registration and resize autocmds, and explicit post-resize registration. The locked Smart Splits revision had removed its prior resize-mode hook, so supported command wrappers now refresh Bufresize after each resize. Native ownership increased to 48 while the catalog remained 68. Proportional terminal resize behavior remains a manual UI check because headless Neovim has no attached UI dimensions for Bufresize to record.

Notify, Recorder, and Fidget followed as one native dependency slice. Recorder now activates on `PackReady` so its intended bare-`q` mapping owns the complete first recording rather than loading after Neovim has already selected a native register. Fresh-process checks covered the first recording from start through stop, Fidget's scheduled post-start activation and global `vim.notify` ownership, suppression of Saga's empty-information message, and `on_open` delegation to Notify. Native ownership increased to 51 while the catalog remained 68.

Gitsigns and Git Conflict completed the Git infrastructure slice. The native loader now evaluates conditional event and filetype triggers against their event buffer, keeps false conditions retryable, and clears sibling triggers after success or terminal failure. Fresh-process fixtures covered non-repository dormancy, later activation after entering a repository, non-current Git buffers, symlinked Gitsigns buffers, key-first Gitsigns staging, cwd-independent key-first conflict resolution, first-buffer hunk selection, and the existing Diffview/Gitlineage paths. Git Conflict intentionally requires the buffer's lexical path to belong to the repository because its state is keyed by that exact path. Native ownership increased to 53 while the catalog remained 68.

The final Phase 7 UI closure moved Devicons, Tiny Devicons Auto Colors, Barbar, Lualine, Trouble, Wilder, and Fzy to native ownership. Focused checks covered Devicons/Tiny ordering, Lualine with dormant optional integrations, Trouble's direct/Todo/help entry points before and after startup, Wilder's first `:`, `/`, and `?` sessions with the native Fzy module, and Barbar's two startup buffers, second post-start buffer, and explicit command/key activation. Tiny's unsafe shared cache is disabled, and Barbar verifies its late bootstrap before activation succeeds. Native ownership increased to 60 while the catalog remained 68.

The required Phase 7 Hyperfine checkpoint used the unchanged command, three warmups, and 21 recorded launches. Mean startup was 42.22 ms, median was 41.50 ms, standard deviation was 2.04 ms, and the range was 39.49-48.45 ms; all launches succeeded. This is 4.68 ms below the Phase 5 mean of 46.9 ms, so Phase 7 introduced no measured startup regression. A separate preceding 21-run confirmation measured 45.4 ms mean with a 3.7 ms standard deviation and a 40.1-51.8 ms range, also below the Phase 5 mean.

Phase 8 moved Mini Sessions, Snacks, and Opencode to native ownership. The loader gained dependency-ordered one-shot `init()` callbacks and conditional startup roots so Mini Sessions remains synchronous only for eligible launches, Snacks can install its `vim.ui` activation wrappers at boot, and Opencode can register session listeners without eagerly loading its package. Opencode activates with Snacks before its first key callback or a qualifying restored Herdr session. Focused checks covered one restore/save lifecycle, file-argument and Git-message exclusions, pre-`PackReady` Snacks input/select dispatch, Opencode boot globals, first-key activation, restored-session ordering, runtime ownership, and unchanged lock revisions. Native ownership increased from 60 to 63 while the catalog remained 68. The next required Hyperfine checkpoint remains Phase 9.

Phase 9 moved Leap, Matchparen, Transparent, Vim Unimpaired, and Zenbones to native ownership and ended Lazy application-spec imports. Explicit native discovery now populates the 68-entry registry before installation and activation; Lazy remains bootstrapped with an empty application graph for rollback. Focused checks covered Leap mappings in normal, visual, and operator-pending modes, Unimpaired mapping installation, Matchparen's first ordinary Insert and Replace paths, Zenwritten-before-Transparent source ordering, `PackReady` keymaps, isolated-XDG installation of all 68 repositories, and the absence of Lazy-owned application runtime paths. All five revisions remained unchanged. The required 21-run Hyperfine checkpoint after three warmups measured 42.96 ms mean, 43.08 ms median, 0.97 ms standard deviation, and a 41.18-44.81 ms range; all launches succeeded. This is 0.74 ms above the Phase 7 mean and 135.89 ms below the historical Phase 0 median, though the Phase 0 comparison remains cross-platform.

Phase 10 removed Lazy from the runtime configuration. Built-in plugin disabling moved to `config.builtins`, the Lazy bootstrap and plugin import aggregator were deleted, and the keybind validator now reads native registry metadata. `lazy-lock.json` and the old Lazy data directory remain unchanged as rollback state. Normal and isolated-XDG startup both discovered, registered, and installed all 68 native packages while the local trigger layer retained runtime activation control; both also confirmed no `:Lazy` command, no loaded Lazy module, and no Lazy runtime module resolution. Neovim health, Lua quality, Stow dry-run, and validation of concrete bindings across five tools passed.

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
