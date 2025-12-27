# Neovim
alias nvim-minimal 'nvim -n -i NONE --noplugin'
alias snvim 'sudo -E -s nvim'
alias vimdiff 'nvim -d'
abbr n nvim
abbr nlup 'nvim --headless +"Lazy! sync" +qa' # lazy update neovim plugins
abbr nwipe 'nvim --headless +"WipeAllSessions!" +qa'
abbr ncheck 'nvim --headless +"checkhealth" +qa'
abbr :qa exit
abbr egnpm export_npm_globals
abbr v nvim

abbr p pnpm
abbr pugi 'pnpm upgrade --interactive --latest --recursive'
abbr pupi 'pnpm update --interactive --recursive'
abbr bup 'brew upgrade'
abbr ff freshfetch

alias cdwow 'cd "/home/fbb/.steam/steam/steamapps/compatdata/3598746258/pfx/drive_c/Program Files (x86)/World of Warcraft"'

alias uge get_week_dates
alias rw remaining_work_hours

# Directory shortcuts - fingers too fast for accuracy ⚡
abbr prj 'cd ~/Projects'
abbr pjr 'cd ~/Projects'
abbr rpj 'cd ~/Projects'

abbr cf 'cd ~/.config'
abbr cnx 'cd /etc/nixos'
abbr nxe 'nvim ~/nixos'
abbr nxu flake_update_interactive
abbr nxud flake_updates_daemon

abbr nxgc nix-collect-garbage

# Helpers
abbr x exit
abbr src 'source ~/.config/fish/config.fish'
abbr makins 'sudo make && sudo make clean install'
abbr cl clear
abbr mki 'sudo make && sudo make clean install'

# File viewing (bat wrappers)
alias cat 'bat --style=plain --color=always'
alias bat_fast 'bat --style=plain --color=never --wrap=never --paging=never'
alias batbuild 'bat cache --build'

# ls aliases using eza
alias ls 'eza --icons -F'
alias l 'eza --icons -F -lh'
alias la 'eza --icons -F -A'
alias lla 'eza --icons -F -la'
alias ld 'eza --icons -F -l --sort=date --ignore-glob="node_modules" -D --time-style=relative'
alias lt 'eza --tree -m --git --level=2 --ignore-glob="node_modules"'

alias lw 'cd (latest_worktree)'

# Tmux
abbr xtm 'pkill -f tmux'
abbr ntm 'tmux new -s'
abbr atm 'tmux attach-session -t'

# Git
abbr ac ai_commit
abbr g git
abbr gs 'git status'
abbr gd 'git diff'
abbr gp 'git push'
abbr gpn 'git push --no-verify'
abbr gpl 'git pull'
abbr gplr 'git pull --rebase'
abbr gf 'git fetch'
abbr gw 'git worktree'
abbr gwa 'git worktree add'
abbr gwr 'git worktree remove'
abbr gwl 'git worktree list'
abbr gau 'git add -u'
abbr gco 'git checkout'
abbr gaa 'git add --all'
abbr gpo 'git pull origin'
abbr gpor 'git pull origin --rebase'
abbr gdorig 'find . -name \*.orig -delete'
abbr gcm --set-cursor 'git commit -m "%"'
abbr gcmn --set-cursor 'git commit -m "%" --no-verify'
abbr co copy_output
abbr gca 'git commit --amend --no-edit'
abbr gaic ai_commit # AI-powered Commitizen commit
abbr gmt 'git mergetool'
abbr grhh 'git reset --hard HEAD'
abbr gcfd 'git clean -fd'
abbr gbda 'git branch | egrep -v "(master|main|develop|\*)" | xargs git branch -D'
abbr gl 'git log --graph --oneline --decorate'
abbr lg lazygit
abbr bad 'git bisect bad'
abbr good 'git bisect good'

# rust
abbr cn 'cargo new'
abbr cc 'cargo check'
abbr cin 'cargo init'
abbr cdoc 'cargo doc'
abbr ca 'cargo add'
abbr crm 'cargo remove'
abbr cb 'cargo build'
abbr cbn 'cargo bench'
abbr cs 'cargo search'
abbr r 'cargo run'
abbr ct 'cargo test'
abbr cu 'cargo update'

# worktree scripts
abbr wta worktree_add
abbr wtc worktrees_clean

# Azure DevOps
abbr atc ado_test_case

# work item extraction
abbr wi workitems_on_date
abbr wid workitems_on_date
abbr wiw workitems_week

# Package manager shortcuts (swpm wrappers)
alias dev 'swpm dev'
alias t 'swpm test'
alias pr 'swpm remove'
alias sb 'swpm storybook'
alias sblg 'swpm cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000'
alias lint 'swpm lint'
alias pw 'swpm workspace'
alias pup 'swpm update-interactive'

# Weather
alias wtr 'curl "wttr.in/Copenhagen?format=%n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n"'
