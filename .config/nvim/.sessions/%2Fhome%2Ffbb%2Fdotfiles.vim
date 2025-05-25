let SessionLoad = 1
let s:cpo_save=&cpo
set cpo&vim
inoremap <silent> <C-Bslash> <Cmd>ToggleTerm
cnoremap <expr> <C-J> wilder#in_context()  ?  wilder#next()  :  '<NL>'
cnoremap <expr> <C-K> wilder#in_context()  ?  wilder#previous()  :  ''
cnoremap <expr> <C-C> wilder#can_reject_completion()  ?  wilder#reject_completion()  :  ''
cnoremap <expr> <C-L> wilder#can_accept_completion()  ?  wilder#accept_completion()  :  ''
cnoremap <silent> <Plug>(TelescopeFuzzyCommandSearch) e "lua require('telescope.builtin').command_history { default_text = [=[" . escape(getcmdline(), '"') . "]=] }"
inoremap <silent> <M-k> :m .-2==gi
inoremap <silent> <M-j> :m .+1==gi
inoremap <silent> <Right> <Nop>
inoremap <silent> <Left> <Nop>
inoremap <silent> <Down> <Nop>
inoremap <silent> <Up> <Nop>
inoremap <C-W> u
inoremap <C-U> u
nnoremap <silent>  <Cmd>BufferPrevious
nnoremap <silent>  <Cmd>BufferNext
nnoremap <silent>  <Cmd>FzfLua files
nnoremap s :split | :wincmd j
nnoremap v :vsplit | :wincmd l
nmap  d
nnoremap <silent> ^[ ^[
nnoremap <silent>  :nohlsearch
nnoremap <silent>  <Cmd>execute v:count . "ToggleTerm"
nnoremap  wk <Cmd>WhichKey
nnoremap <silent>  tr <Cmd>Trouble lsp_references
nnoremap <silent>  tq <Cmd>Trouble quickfix
nnoremap <silent>  tl <Cmd>Trouble loclist
nnoremap <silent>  tt <Cmd>TodoTrouble
nnoremap <silent>  td <Cmd>Trouble diagnostics
nnoremap <silent>  tx <Cmd>TroubleToggle
nnoremap <silent>  tz <Cmd>TroubleClose
nnoremap <silent>  x :only | :BufferCloseAllButVisible
nnoremap <silent>  P <Cmd>BufferPin
nnoremap <silent>  pc <Cmd>CccPick
nnoremap  e <Cmd>NvimTreeToggle
nnoremap  ff <Cmd>NvimTreeFindFile
nnoremap <silent>  od <Cmd>OverseerLoadBundle dev
nnoremap <silent>  or <Cmd>OverseerRun
nnoremap <silent>  ot <Cmd>OverseerToggle
vnoremap <silent>  al <Cmd>ChatGPTRun code_readability_analysis
nnoremap <silent>  al <Cmd>ChatGPTRun code_readability_analysis
vnoremap <silent>  ar <Cmd>ChatGPTRun roxygen_edit
nnoremap <silent>  ar <Cmd>ChatGPTRun roxygen_edit
vnoremap <silent>  ax <Cmd>ChatGPTRun explain_code
nnoremap <silent>  ax <Cmd>ChatGPTRun explain_code
vnoremap <silent>  af <Cmd>ChatGPTRun fix_bugs
nnoremap <silent>  af <Cmd>ChatGPTRun fix_bugs
vnoremap <silent>  as <Cmd>ChatGPTRun summarize
nnoremap <silent>  as <Cmd>ChatGPTRun summarize
vnoremap <silent>  ao <Cmd>ChatGPTRun optimize_code
nnoremap <silent>  ao <Cmd>ChatGPTRun optimize_code
vnoremap <silent>  aa <Cmd>ChatGPTRun add_tests
nnoremap <silent>  aa <Cmd>ChatGPTRun add_tests
vnoremap <silent>  ad <Cmd>ChatGPTRun docstring
nnoremap <silent>  ad <Cmd>ChatGPTRun docstring
vnoremap <silent>  ak <Cmd>ChatGPTRun keywords
nnoremap <silent>  ak <Cmd>ChatGPTRun keywords
vnoremap <silent>  at <Cmd>ChatGPTRun translate
nnoremap <silent>  at <Cmd>ChatGPTRun translate
vnoremap <silent>  ag <Cmd>ChatGPTRun grammar_correction
nnoremap <silent>  ag <Cmd>ChatGPTRun grammar_correction
vnoremap <silent>  ae <Cmd>ChatGPTEditWithInstruction
nnoremap <silent>  ae <Cmd>ChatGPTEditWithInstruction
nnoremap <silent>  ac <Cmd>ChatGPT
nnoremap <silent>  lg <Cmd>FzfRg
nnoremap <silent>  of <Cmd>FzfLua oldfiles
nnoremap <silent>  b <Cmd>FzfLua buffers
vnoremap <silent>  lg <Cmd>FzfRgVisualSelection
nnoremap <silent>  0 :b#
nnoremap <silent>  bd :bp | :bd #
nnoremap <silent>  db d?$
nnoremap <silent>  fb :lua vim.lsp.buf.format()
nnoremap <silent>  Q :qa!
nnoremap <silent>  q :qa
nnoremap <silent>  S :wqa!
nnoremap <silent>  s :wall
nnoremap <silent>  r :%s///gI<Left><Left><Left>
nnoremap <silent>  yf :%y
nnoremap <silent>  fc /<<<
vnoremap <silent>  dc <Cmd>DiffClip
nnoremap <silent>   <Nop>
nnoremap & :&&
nnoremap <silent> ,P "0P
nnoremap <silent> ,p "0p
nnoremap <silent> - /
xnoremap <silent> : ;
nnoremap <silent> : ;
xnoremap <silent> ; :
nnoremap <silent> ; :
nmap <s <Plug>(unimpaired-enable)
nmap <P <Plug>(unimpaired-put-above-leftward)
nmap <p <Plug>(unimpaired-put-below-leftward)
vnoremap <silent> < <gv
nmap =s <Plug>(unimpaired-toggle)
nmap =P <Plug>(unimpaired-put-above-reformat)
nmap =p <Plug>(unimpaired-put-below-reformat)
nmap >s <Plug>(unimpaired-disable)
nmap >P <Plug>(unimpaired-put-above-rightward)
nmap >p <Plug>(unimpaired-put-below-rightward)
vnoremap <silent> > >gv
xnoremap <silent> <expr> @ mode() ==# 'V' ? ':normal! @'.getcharstr().'' : '@'
nnoremap H :wincmd h
nnoremap J :wincmd j
nnoremap K :wincmd k
nnoremap L :wincmd l
xnoremap <silent> <expr> Q mode() ==# 'V' ? ':normal! @=reg_recorded()' : 'Q'
onoremap <silent> S <Plug>(leap-backward-to)
xnoremap <silent> S <Plug>(leap-backward-to)
nnoremap <silent> S <Plug>(leap-backward-to)
xnoremap <silent> X <Plug>(leap-backward-till)
onoremap <silent> X <Plug>(leap-backward-till)
nnoremap Y y$
nmap [f <Plug>(unimpaired-directory-previous)
nmap [n <Plug>(unimpaired-context-previous)
xmap [n <Plug>(unimpaired-context-previous)
omap [n <Plug>(unimpaired-context-previous)
nmap [e <Plug>(unimpaired-move-up)
xmap [e <Plug>(unimpaired-move-selection-up)
nmap [o <Plug>(unimpaired-enable)
nmap [p <Plug>(unimpaired-put-above)
nmap [P <Plug>(unimpaired-put-above)
nmap [y <Plug>(unimpaired-string-encode)
xmap [y <Plug>(unimpaired-string-encode)
nmap [yy <Plug>(unimpaired-string-encode-line)
nmap [C <Plug>(unimpaired-string-encode)
xmap [C <Plug>(unimpaired-string-encode)
nmap [CC <Plug>(unimpaired-string-encode-line)
nmap [u <Plug>(unimpaired-url-encode)
xmap [u <Plug>(unimpaired-url-encode)
nmap [uu <Plug>(unimpaired-url-encode-line)
nmap [x <Plug>(unimpaired-xml-encode)
xmap [x <Plug>(unimpaired-xml-encode)
nmap [xx <Plug>(unimpaired-xml-encode-line)
nmap ]f <Plug>(unimpaired-directory-next)
nmap ]n <Plug>(unimpaired-context-next)
xmap ]n <Plug>(unimpaired-context-next)
omap ]n <Plug>(unimpaired-context-next)
nmap ]e <Plug>(unimpaired-move-down)
xmap ]e <Plug>(unimpaired-move-selection-down)
nmap ]o <Plug>(unimpaired-disable)
nmap ]p <Plug>(unimpaired-put-below)
nmap ]P <Plug>(unimpaired-put-below)
nmap ]y <Plug>(unimpaired-string-decode)
xmap ]y <Plug>(unimpaired-string-decode)
nmap ]yy <Plug>(unimpaired-string-decode-line)
nmap ]C <Plug>(unimpaired-string-decode)
xmap ]C <Plug>(unimpaired-string-decode)
nmap ]CC <Plug>(unimpaired-string-decode-line)
nmap ]u <Plug>(unimpaired-url-decode)
xmap ]u <Plug>(unimpaired-url-decode)
nmap ]uu <Plug>(unimpaired-url-decode-line)
nmap ]x <Plug>(unimpaired-xml-decode)
xmap ]x <Plug>(unimpaired-xml-decode)
nmap ]xx <Plug>(unimpaired-xml-decode-line)
nnoremap b <Cmd>lua require('spider').motion('b')
xnoremap b <Cmd>lua require('spider').motion('b')
onoremap b <Cmd>lua require('spider').motion('b')
nnoremap e <Cmd>lua require('spider').motion('e')
xnoremap e <Cmd>lua require('spider').motion('e')
onoremap e <Cmd>lua require('spider').motion('e')
onoremap <silent> gs <Plug>(leap-cross-window)
xnoremap <silent> gs <Plug>(leap-cross-window)
nnoremap <silent> gs <Plug>(leap-cross-window)
xnoremap <silent> p "_dP
onoremap <silent> s <Plug>(leap-forward-to)
xnoremap <silent> s <Plug>(leap-forward-to)
nnoremap <silent> s <Plug>(leap-forward-to)
xnoremap <silent> sa :lua MiniSurround.add('visual')
xnoremap w <Cmd>lua require('spider').motion('w')
onoremap w <Cmd>lua require('spider').motion('w')
nnoremap w <Cmd>lua require('spider').motion('w')
xnoremap <silent> x <Plug>(leap-forward-till)
onoremap <silent> x <Plug>(leap-forward-till)
nmap yo <Plug>(unimpaired-toggle)
nnoremap <C-3> <Cmd>BufferGoto 3
nnoremap <C-2> <Cmd>BufferGoto 2
nnoremap <C-1> <Cmd>BufferGoto 1
nnoremap <silent> <C-L> <Cmd>BufferNext
nnoremap <silent> <C-H> <Cmd>BufferPrevious
nnoremap <C-9> <Cmd>BufferGoto 9
nnoremap <C-8> <Cmd>BufferGoto 8
nnoremap <C-7> <Cmd>BufferGoto 7
nnoremap <C-6> <Cmd>BufferGoto 6
nnoremap <C-5> <Cmd>BufferGoto 5
nnoremap <C-4> <Cmd>BufferGoto 4
nnoremap <silent> <C-Bslash> <Cmd>execute v:count . "ToggleTerm"
nnoremap <silent> <Plug>(unimpaired-previous) :exe "".(v:count ? v:count : "")."previous"
nnoremap <silent> <Plug>(unimpaired-next) :exe "".(v:count ? v:count : "")."next"
nnoremap <Plug>(unimpaired-first) :=v:count ? v:count . "argument" : "first"
nnoremap <Plug>(unimpaired-last) :=v:count ? v:count . "argument" : "last"
nnoremap <silent> <Plug>unimpairedAPrevious :exe "".(v:count ? v:count : "")."previous"
nnoremap <silent> <Plug>unimpairedANext :exe "".(v:count ? v:count : "")."next"
nnoremap <silent> <Plug>unimpairedAFirst :exe "".(v:count ? v:count : "")."first"
nnoremap <silent> <Plug>unimpairedALast :exe "".(v:count ? v:count : "")."last"
nnoremap <silent> <Plug>(unimpaired-bprevious) :exe "".(v:count ? v:count : "")."bprevious"
nnoremap <silent> <Plug>(unimpaired-bnext) :exe "".(v:count ? v:count : "")."bnext"
nnoremap <Plug>(unimpaired-bfirst) :=v:count ? v:count . "buffer" : "bfirst"
nnoremap <Plug>(unimpaired-blast) :=v:count ? v:count . "buffer" : "blast"
nnoremap <silent> <Plug>unimpairedBPrevious :exe "".(v:count ? v:count : "")."bprevious"
nnoremap <silent> <Plug>unimpairedBNext :exe "".(v:count ? v:count : "")."bnext"
nnoremap <silent> <Plug>unimpairedBFirst :exe "".(v:count ? v:count : "")."bfirst"
nnoremap <silent> <Plug>unimpairedBLast :exe "".(v:count ? v:count : "")."blast"
nnoremap <silent> <Plug>(unimpaired-lprevious) :exe "".(v:count ? v:count : "")."lprevious"zv
nnoremap <silent> <Plug>(unimpaired-lnext) :exe "".(v:count ? v:count : "")."lnext"zv
nnoremap <Plug>(unimpaired-lfirst) :=v:count ? v:count . "ll" : "lfirst"zv
nnoremap <Plug>(unimpaired-llast) :=v:count ? v:count . "ll" : "llast"zv
nnoremap <silent> <Plug>unimpairedLPrevious :exe "".(v:count ? v:count : "")."lprevious"zv
nnoremap <silent> <Plug>unimpairedLNext :exe "".(v:count ? v:count : "")."lnext"zv
nnoremap <silent> <Plug>unimpairedLFirst :exe "".(v:count ? v:count : "")."lfirst"zv
nnoremap <silent> <Plug>unimpairedLLast :exe "".(v:count ? v:count : "")."llast"zv
nnoremap <silent> <Plug>(unimpaired-lpfile) :exe "".(v:count ? v:count : "")."lpfile"zv
nnoremap <silent> <Plug>(unimpaired-lnfile) :exe "".(v:count ? v:count : "")."lnfile"zv
nnoremap <silent> <Plug>unimpairedLPFile :exe "".(v:count ? v:count : "")."lpfile"zv
nnoremap <silent> <Plug>unimpairedLNFile :exe "".(v:count ? v:count : "")."lnfile"zv
nnoremap <silent> <Plug>(unimpaired-cprevious) :exe "".(v:count ? v:count : "")."cprevious"zv
nnoremap <silent> <Plug>(unimpaired-cnext) :exe "".(v:count ? v:count : "")."cnext"zv
nnoremap <Plug>(unimpaired-cfirst) :=v:count ? v:count . "cc" : "cfirst"zv
nnoremap <Plug>(unimpaired-clast) :=v:count ? v:count . "cc" : "clast"zv
nnoremap <silent> <Plug>unimpairedQPrevious :exe "".(v:count ? v:count : "")."cprevious"zv
nnoremap <silent> <Plug>unimpairedQNext :exe "".(v:count ? v:count : "")."cnext"zv
nnoremap <silent> <Plug>unimpairedQFirst :exe "".(v:count ? v:count : "")."cfirst"zv
nnoremap <silent> <Plug>unimpairedQLast :exe "".(v:count ? v:count : "")."clast"zv
nnoremap <silent> <Plug>(unimpaired-cpfile) :exe "".(v:count ? v:count : "")."cpfile"zv
nnoremap <silent> <Plug>(unimpaired-cnfile) :exe "".(v:count ? v:count : "")."cnfile"zv
nnoremap <silent> <Plug>unimpairedQPFile :exe "".(v:count ? v:count : "")."cpfile"zv
nnoremap <silent> <Plug>unimpairedQNFile :exe "".(v:count ? v:count : "")."cnfile"zv
nnoremap <silent> <Plug>(unimpaired-tprevious) :exe "".(v:count ? v:count : "")."tprevious"
nnoremap <silent> <Plug>(unimpaired-tnext) :exe "".(v:count ? v:count : "")."tnext"
nnoremap <Plug>(unimpaired-tfirst) :=v:count ? v:count . "trewind" : "tfirst"
nnoremap <Plug>(unimpaired-tlast) :=v:count ? v:count . "trewind" : "tlast"
nnoremap <silent> <Plug>unimpairedTPrevious :exe "".(v:count ? v:count : "")."tprevious"
nnoremap <silent> <Plug>unimpairedTNext :exe "".(v:count ? v:count : "")."tnext"
nnoremap <silent> <Plug>unimpairedTFirst :exe "".(v:count ? v:count : "")."tfirst"
nnoremap <silent> <Plug>unimpairedTLast :exe "".(v:count ? v:count : "")."tlast"
nnoremap <silent> <Plug>(unimpaired-ptprevious) :exe v:count1 . "ptprevious"
nnoremap <silent> <Plug>(unimpaired-ptnext) :exe v:count1 . "ptnext"
nnoremap <silent> <Plug>unimpairedTPPrevious :exe "p".(v:count ? v:count : "")."tprevious"
nnoremap <silent> <Plug>unimpairedTPNext :exe "p".(v:count ? v:count : "")."tnext"
nnoremap <silent> <Plug>(leap-cross-window) <Plug>(leap-from-window)
xnoremap <silent> <Plug>(leap-cross-window) <Plug>(leap-from-window)
onoremap <silent> <Plug>(leap-cross-window) <Plug>(leap-from-window)
nnoremap <Plug>JqxList :lua require('nvim-jqx').jqx_open()
nnoremap <Plug>PlenaryTestFile :lua require('plenary.test_harness').test_file(vim.fn.expand("%:p"))
nnoremap <silent> <M-t> <Cmd>FTermToggle
tnoremap <silent> <M-t> <Cmd>FTermToggle
nnoremap <silent> <C-P> <Cmd>FzfLua files
nnoremap <C-W>s :split | :wincmd j
nnoremap <C-W>v :vsplit | :wincmd l
nnoremap <silent> <C-S-L> :wincmd L
nnoremap <silent> <C-S-L> :wincmd L
nnoremap <silent> <C-S-K> :wincmd K
nnoremap <silent> <C-S-K> :wincmd K
nnoremap <silent> <C-S-J> :wincmd J
nnoremap <silent> <S-NL> :wincmd J
nnoremap <silent> <C-S-H> :wincmd H
nnoremap <silent> <C-S-H> :wincmd H
vnoremap <silent> <M-k> :m '<-2gv=gv
vnoremap <silent> <M-j> :m '>+1gv=gv
nnoremap <silent> <M-k> :m .-2==
nnoremap <silent> <M-j> :m .+1==
nmap <C-W><C-D> d
cnoremap <expr>  wilder#can_reject_completion()  ?  wilder#reject_completion()  :  ''
cnoremap <expr> <NL> wilder#in_context()  ?  wilder#next()  :  '<NL>'
cnoremap <expr>  wilder#in_context()  ?  wilder#previous()  :  ''
cnoremap <expr>  wilder#can_accept_completion()  ?  wilder#accept_completion()  :  ''
inoremap <expr>  v:lua.require'nvim-autopairs'.completion_confirm()
inoremap  u
inoremap  u
inoremap <silent>  <Cmd>ToggleTerm
xnoremap <silent> ¨ ]
nnoremap <silent> ¨ ]
xnoremap <silent> å [
xnoremap <silent> ø '
xnoremap <silent> æ :
nnoremap <silent> å [
nnoremap <silent> ø '
nnoremap <silent> æ :
abbr sucess success
abbr intial initial
abbr stuct struct
abbr occassion occasion
abbr sucessful successful
abbr listner listener
abbr promsie promise
abbr acheive achieve
abbr enviroment environment
abbr moduel module
abbr environment environment
abbr promse promise
abbr untill until
abbr destory destroy
abbr visiblity visibility
abbr occured occurred
abbr cahnge change
abbr recieve receive
abbr temprary temporary
abbr histroy history
abbr definately definitely
abbr futher further
abbr pakage package
abbr seperate separate
abbr adress address
abbr cancle cancel
abbr teh the
abbr satic static
abbr temproary temporary
cabbr wqa Z
let &cpo=s:cpo_save
unlet s:cpo_save
set backup
set backupdir=~/.config/nvim/nvim/.backup//
set clipboard=unnamedplus
set complete=kspell
set completeopt=menu,menuone,noinsert
set directory=~/.config/nvim/nvim/.swp//
set expandtab
set fillchars=eob:\ 
set foldlevelstart=0
set grepformat=%f:%l:%c:%m
set grepprg=rg\ --vimgrep\ -uu\ 
set nohlsearch
set ignorecase
set inccommand=split
set laststatus=3
set lazyredraw
set listchars=nbsp:␣,tab:▏\ ,trail:·
set noloadplugins
set mouse=a
set packpath=/home/linuxbrew/.linuxbrew/Cellar/neovim/0.11.1/share/nvim/runtime
set path=.,,**
set pumblend=10
set runtimepath=
set runtimepath+=~/.config/nvim
set runtimepath+=~/.local/share/nvim/lazy/lazy.nvim
set runtimepath+=~/.local/share/nvim/lazy/fzy-lua-native
set runtimepath+=~/.local/share/nvim/lazy/wilder.nvim
set runtimepath+=~/.local/share/nvim/lazy/nvim-scrollbar
set runtimepath+=~/.local/share/nvim/lazy/live-command.nvim
set runtimepath+=~/.local/share/nvim/lazy/vim-unimpaired
set runtimepath+=~/.local/share/nvim/lazy/fidget.nvim
set runtimepath+=~/.local/share/nvim/lazy/which-key.nvim
set runtimepath+=~/.local/share/nvim/lazy/trouble.nvim
set runtimepath+=~/.local/share/nvim/lazy/barbar.nvim
set runtimepath+=~/.local/share/nvim/lazy/NeoComposer.nvim
set runtimepath+=~/.local/share/nvim/lazy/git-blame.nvim
set runtimepath+=~/.local/share/nvim/lazy/lualine.nvim
set runtimepath+=~/.local/share/nvim/lazy/ccc.nvim
set runtimepath+=~/.local/share/nvim/lazy/tint.nvim
set runtimepath+=~/.local/share/nvim/lazy/leap.nvim
set runtimepath+=~/.local/share/nvim/lazy/eyeliner.nvim
set runtimepath+=~/.local/share/nvim/lazy/toggleterm.nvim
set runtimepath+=~/.local/share/nvim/lazy/git-conflict.nvim
set runtimepath+=~/.local/share/nvim/lazy/gitsigns.nvim
set runtimepath+=~/.local/share/nvim/lazy/nvim-toggler
set runtimepath+=~/.local/share/nvim/lazy/nvim-spider
set runtimepath+=~/.local/share/nvim/lazy/ts-comments.nvim
set runtimepath+=~/.local/share/nvim/lazy/inc-rename.nvim
set runtimepath+=~/.local/share/nvim/lazy/todo-comments.nvim
set runtimepath+=~/.local/share/nvim/lazy/vim-repeat
set runtimepath+=~/.local/share/nvim/lazy/nvim-ts-autotag
set runtimepath+=~/.local/share/nvim/lazy/nvim-treesitter
set runtimepath+=~/.local/share/nvim/lazy/hlargs.nvim
set runtimepath+=~/.local/share/nvim/lazy/typescript-tools.nvim
set runtimepath+=~/.local/share/nvim/lazy/lazydev.nvim
set runtimepath+=~/.local/share/nvim/lazy/lspsaga.nvim
set runtimepath+=~/.local/share/nvim/lazy/mason.nvim
set runtimepath+=~/.local/share/nvim/lazy/mason-tool-installer.nvim
set runtimepath+=~/.local/share/nvim/lazy/mason-lspconfig.nvim
set runtimepath+=~/.local/share/nvim/lazy/nvim-lsp-file-operations
set runtimepath+=~/.local/share/nvim/lazy/nvim-lspconfig
set runtimepath+=~/.local/share/nvim/lazy/FTerm.nvim
set runtimepath+=~/.local/share/nvim/lazy/fzf-lua
set runtimepath+=~/.local/share/nvim/lazy/nvim-jqx
set runtimepath+=~/.local/share/nvim/lazy/nui.nvim
set runtimepath+=~/.local/share/nvim/lazy/chatgpt.nvim
set runtimepath+=~/.local/share/nvim/lazy/render-markdown.nvim
set runtimepath+=~/.local/share/nvim/lazy/supermaven-nvim
set runtimepath+=~/.local/share/nvim/lazy/mini.surround
set runtimepath+=~/.local/share/nvim/lazy/matchparen.nvim
set runtimepath+=~/.local/share/nvim/lazy/nvim-autopairs
set runtimepath+=~/.local/share/nvim/lazy/cmp-omni
set runtimepath+=~/.local/share/nvim/lazy/cmp-buffer
set runtimepath+=~/.local/share/nvim/lazy/cmp-path
set runtimepath+=~/.local/share/nvim/lazy/lspkind.nvim
set runtimepath+=~/.local/share/nvim/lazy/cmp_luasnip
set runtimepath+=~/.local/share/nvim/lazy/cmp-fish
set runtimepath+=~/.local/share/nvim/lazy/cmp-nvim-lua
set runtimepath+=~/.local/share/nvim/lazy/cmp-spell
set runtimepath+=~/.local/share/nvim/lazy/LuaSnip
set runtimepath+=~/.local/share/nvim/lazy/cmp-nvim-lsp
set runtimepath+=~/.local/share/nvim/lazy/nvim-cmp
set runtimepath+=~/.local/share/nvim/lazy/indent-blankline.nvim
set runtimepath+=~/.local/share/nvim/lazy/snacks.nvim
set runtimepath+=~/.local/share/nvim/lazy/local-highlight.nvim
set runtimepath+=~/.local/share/nvim/lazy/tiny-devicons-auto-colors.nvim
set runtimepath+=~/.local/share/nvim/lazy/lush.nvim
set runtimepath+=~/.local/share/nvim/lazy/zenbones.nvim
set runtimepath+=~/.local/share/nvim/lazy/nvim-web-devicons
set runtimepath+=~/.local/share/nvim/lazy/dressing.nvim
set runtimepath+=~/.local/share/nvim/lazy/nvim-tree.lua
set runtimepath+=~/.local/share/nvim/lazy/nvim-notify
set runtimepath+=~/.local/share/nvim/lazy/nvim-recorder
set runtimepath+=~/.local/share/nvim/lazy/peek.nvim
set runtimepath+=~/.local/share/nvim/lazy/helpview.nvim
set runtimepath+=~/.local/share/nvim/lazy/plenary.nvim
set runtimepath+=~/.local/share/nvim/lazy/telescope.nvim
set runtimepath+=~/.local/share/nvim/lazy/overseer.nvim
set runtimepath+=~/.local/share/nvim/lazy/auto-session
set runtimepath+=~/.local/share/nvim/lazy/conform.nvim
set runtimepath+=/home/linuxbrew/.linuxbrew/Cellar/neovim/0.11.1/share/nvim/runtime
set runtimepath+=/home/linuxbrew/.linuxbrew/Cellar/neovim/0.11.1/lib/nvim
set runtimepath+=~/.local/state/nvim/lazy/readme
set runtimepath+=~/.local/share/nvim/lazy/mason-lspconfig.nvim/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-omni/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-buffer/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-path/after
set runtimepath+=~/.local/share/nvim/lazy/cmp_luasnip/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-fish/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-nvim-lua/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-spell/after
set runtimepath+=~/.local/share/nvim/lazy/cmp-nvim-lsp/after
set runtimepath+=~/.local/share/nvim/lazy/indent-blankline.nvim/after
set scrolloff=8
set sessionoptions=globals,localoptions,options,buffers,tabpages,folds,curdir
set shadafile=NONE
set shell=fish
set shiftwidth=2
set shortmess=lIOTotCF
set noshowmode
set showtabline=2
set smartcase
set smartindent
set softtabstop=2
set spelllang=en_us,da
set spelloptions=noplainbuffer
set splitbelow
set splitright
set statusline=%#lualine_transparent#
set noswapfile
set tabline=%2@barbar#events#main_click_handler@%#BufferInactiveSign#▎%#BufferInactive#\ \ \ \ \ \ %#DevIconTmuxInactive#\ %2@barbar#events#main_click_handler@%#BufferInactive#tmux.conf%#BufferInactive#\ \ \ \ \ \ %2@barbar#events#close_click_handler@%#BufferInactiveBtn#\ %2@barbar#events#main_click_handler@%#BufferInactiveSignRight#%3@barbar#events#main_click_handler@%#BufferInactiveSign#▎%#BufferInactive#\ \ \ \ \ \ %#DevIconYmlInactive#\ %3@barbar#events#main_click_handler@%#BufferInactive#zenwritten-dark.yml%#BufferInactive#\ \ \ \ \ \ %3@barbar#events#close_click_handler@%#BufferInactiveBtn#\ %3@barbar#events#main_click_handler@%#BufferInactiveSignRight#%4@barbar#events#main_click_handler@%#BufferCurrentSign#▎%#BufferCurrent#\ \ \ \ \ \ %#DevIconGitIgnoreCurrent#\ %4@barbar#events#main_click_handler@%#BufferCurrent#.gitignore%#BufferCurrent#\ \ \ \ \ \ %4@barbar#events#close_click_handler@%#BufferCurrentBtn#\ %4@barbar#events#main_click_handler@%#BufferCurrentSignRight#%#BufferTabpageFill#\ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ \ %0@barbar#events#main_click_handler@%#BufferTabpageFill#
set tabstop=2
set termguicolors
set timeoutlen=300
set undodir=~/.config/nvim/nvim/.undo//
set undofile
set updatecount=0
set updatetime=250
set wildcharm=<Tab>
set wildignore=*/node_modules/*,*/.npm/*,*.cache*,*go*,*.swp*,*/tmp/*,*/Caches/*,*log*,*.dat*,*.kbx*,*.zip*
set wildoptions=pum
set window=65
let s:so_save = &g:so | let s:siso_save = &g:siso | setg so=0 siso=0 | setl so=-1 siso=-1
let v:this_session=expand("<sfile>:p")
let NvimTreeSetup =  1 
let NvimTreeRequired =  1 
silent only
silent tabonly
cd ~/dotfiles
if expand('%') == '' && !&modified && line('$') <= 1 && getline(1) == ''
  let s:wipebuf = bufnr('%')
endif
if &shortmess =~ 'A'
  set shortmess=aoOA
else
  set shortmess=aoO
endif
badd +1 .config/tmux/tmux.conf
badd +1 .config/vivid/themes/zenwritten-dark.yml
badd +18 .gitignore
argglobal
%argdel
edit .gitignore
argglobal
balt .config/vivid/themes/zenwritten-dark.yml
setlocal keymap=
setlocal noarabic
setlocal autoindent
setlocal nobinary
set breakindent
setlocal breakindent
setlocal breakindentopt=
setlocal bufhidden=
setlocal buflisted
setlocal buftype=
setlocal nocindent
setlocal cinkeys=0{,0},0),0],:,0#,!^F,o,O,e
setlocal cinoptions=
setlocal cinscopedecls=public,protected,private
setlocal cinwords=if,else,while,do,for,switch
setlocal colorcolumn=
setlocal comments=:#
setlocal commentstring=#\ %s
setlocal complete=kspell
setlocal completefunc=
setlocal completeslash=
setlocal concealcursor=
setlocal conceallevel=0
setlocal nocopyindent
setlocal nocursorbind
setlocal nocursorcolumn
set cursorline
setlocal cursorline
setlocal cursorlineopt=both
setlocal nodiff
setlocal eventignorewin=
setlocal expandtab
if &filetype != 'gitignore'
setlocal filetype=gitignore
endif
setlocal fixendofline
set foldcolumn=1
setlocal foldcolumn=1
setlocal foldenable
set foldexpr=nvim_treesitter#foldexpr()
setlocal foldexpr=nvim_treesitter#foldexpr()
setlocal foldignore=#
setlocal foldlevel=0
setlocal foldmarker={{{,}}}
set foldmethod=marker
setlocal foldmethod=marker
setlocal foldminlines=1
setlocal foldnestmax=20
set foldtext=
setlocal foldtext=
setlocal formatexpr=
setlocal formatlistpat=^\\s*\\d\\+[\\]:.)}\\t\ ]\\s*
setlocal formatoptions=tcqj
setlocal iminsert=0
setlocal imsearch=-1
setlocal includeexpr=
setlocal indentexpr=
setlocal indentkeys=0{,0},0),0],:,0#,!^F,o,O,e
setlocal noinfercase
setlocal iskeyword=@,48-57,_,192-255
setlocal nolinebreak
setlocal nolisp
setlocal lispoptions=
set list
setlocal list
setlocal matchpairs=(:),{:},[:]
setlocal modeline
setlocal modifiable
setlocal nrformats=bin,hex
set number
setlocal number
setlocal numberwidth=4
setlocal omnifunc=
setlocal nopreserveindent
setlocal nopreviewwindow
setlocal quoteescape=\\
setlocal noreadonly
set relativenumber
setlocal relativenumber
setlocal norightleft
setlocal rightleftcmd=search
setlocal scrollback=-1
setlocal noscrollbind
setlocal shiftwidth=2
set signcolumn=yes
setlocal signcolumn=yes
setlocal smartindent
setlocal nosmoothscroll
setlocal softtabstop=2
set spell
setlocal spell
setlocal spellcapcheck=[.?!]\\_[\\])'\"\\t\ ]\\+
setlocal spellfile=
setlocal spelllang=en_us,da
setlocal spelloptions=noplainbuffer
setlocal statuscolumn=
setlocal statusline=%#lualine_a_command#\ COMMAND\ %<%#lualine_c_normal#\ \ master\ %#lualine_c_normal#%=%#lualine_c_normal#\ \ You\ \ \ just\ now\ \ ���\ 14b3a22\ \ %#lualine_b_normal#\ \ gitignore\ %#lualine_a_command#\ \ 18:1\ \ 
setlocal suffixesadd=
setlocal noswapfile
setlocal synmaxcol=3000
if &syntax != ''
setlocal syntax=
endif
setlocal tabstop=2
setlocal tagfunc=
setlocal textwidth=0
setlocal undofile
setlocal varsofttabstop=
setlocal vartabstop=
setlocal winblend=0
setlocal nowinfixbuf
setlocal nowinfixheight
setlocal nowinfixwidth
setlocal winhighlight=
set nowrap
setlocal nowrap
setlocal wrapmargin=0
let s:l = 18 - ((17 * winheight(0) + 31) / 63)
if s:l < 1 | let s:l = 1 | endif
keepjumps exe s:l
normal! zt
keepjumps 18
normal! 0
tabnext 1
if exists('s:wipebuf') && len(win_findbuf(s:wipebuf)) == 0 && getbufvar(s:wipebuf, '&buftype') isnot# 'terminal'
  silent exe 'bwipe ' . s:wipebuf
endif
unlet! s:wipebuf
set winheight=1 winwidth=20
set shortmess=lIOTotCF
let s:sx = expand("<sfile>:p:r")."x.vim"
if filereadable(s:sx)
  exe "source " . fnameescape(s:sx)
endif
let &g:so = s:so_save | let &g:siso = s:siso_save
nohlsearch
doautoall SessionLoadPost
unlet SessionLoad
" vim: set ft=vim :
