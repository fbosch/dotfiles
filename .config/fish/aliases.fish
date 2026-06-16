# Neovim
function nvim --description 'alias nvim nvim -i NONE --noplugin'
    command nvim -i NONE --noplugin $argv
end

function snvim --wraps='sudo -E -s nvim' --description 'alias snvim sudo -E -s nvim'
    sudo -E -s nvim $argv
end

function vimdiff --wraps='nvim -d' --description 'alias vimdiff nvim -d'
    nvim -d $argv
end

function pip --description 'alias pip uv pip'
    uv pip $argv
end
abbr n nvim
abbr nlup 'nvim --headless +"Lazy! sync" +qa' # lazy update neovim plugins
abbr nwipe 'nvim --headless +"WipeAllSessions!" +qa'
abbr ncheck 'nvim --headless +"checkhealth" +qa'
abbr :qa exit
abbr v nvim

abbr p pnpm
abbr pugi 'pnpm upgrade --interactive --latest --recursive'
abbr pupi 'pnpm update --interactive --recursive'
abbr bup 'brew upgrade'
abbr ff freshfetch
abbr mrs5 mullvad_random_socks5

function cdwow --wraps='cd "/home/fbb/Faugus/battlenet/drive_c/Program Files (x86)/World of Warcraft"' --description 'alias cdwow cd "/home/fbb/Faugus/battlenet/drive_c/Program Files (x86)/World of Warcraft"'
    cd "/home/fbb/Faugus/battlenet/drive_c/Program Files (x86)/World of Warcraft" $argv
end

function uge --wraps=get_week_dates --description 'alias uge get_week_dates'
    get_week_dates $argv
end

function rw --wraps=remaining_work_hours --description 'alias rw remaining_work_hours'
    remaining_work_hours $argv
end

# Directory shortcuts - fingers too fast for accuracy ⚡
abbr prj 'cd ~/Projects'
abbr pjr 'cd ~/Projects'
abbr rpj 'cd ~/Projects'

abbr attp 'attic push nix-cache $(nix path-info /run/current-system/)'
abbr nxe 'nvim ~/nixos'
abbr nxu flake_update_interactive
abbr nxud flake_updates_daemon
abbr nxgc nix-collect-garbage

# OpenCode
abbr oc opencode
abbr ocps opencode_profile_switch
abbr ocas opencode_auth_switch

abbr liw linear_issue_workflow
function wsc --wraps='wt switch --create --execute=opencode' --description 'alias wsc wt switch --create --execute=opencode'
    wt switch --create --execute=opencode $argv
end

# Helpers
abbr x exit
abbr src 'source ~/.config/fish/config.fish'
abbr makins 'sudo make && sudo make clean install'
abbr cl clear
abbr mki 'sudo make && sudo make clean install'

# File viewing (bat wrappers)
function cat --wraps='bat --style=plain --color=always' --description 'alias cat bat --style=plain --color=always'
    bat --style=plain --color=always $argv
end

function bat_fast --wraps='bat --style=plain --color=never --wrap=never --paging=never' --description 'alias bat_fast bat --style=plain --color=never --wrap=never --paging=never'
    bat --style=plain --color=never --wrap=never --paging=never $argv
end

function batbuild --wraps='bat cache --build' --description 'alias batbuild bat cache --build'
    bat cache --build $argv
end

# ls aliases using eza
function ls --wraps='eza --icons -F' --description 'alias ls eza --icons -F'
    eza --icons -F $argv
end

function l --wraps='eza --icons -F -lh' --description 'alias l eza --icons -F -lh'
    eza --icons -F -lh $argv
end

function la --wraps='eza --icons -F -A' --description 'alias la eza --icons -F -A'
    eza --icons -F -A $argv
end

function lla --wraps='eza --icons -F -la' --description 'alias lla eza --icons -F -la'
    eza --icons -F -la $argv
end

function ld --wraps='eza --icons -F -l --sort=date --ignore-glob="node_modules" -D --time-style=relative' --description 'alias ld eza --icons -F -l --sort=date --ignore-glob="node_modules" -D --time-style=relative'
    eza --icons -F -l --sort=date --ignore-glob="node_modules" -D --time-style=relative $argv
end

function lt --wraps='eza --tree -m --git --level=2 --ignore-glob="node_modules"' --description 'alias lt eza --tree -m --git --level=2 --ignore-glob="node_modules"'
    eza --tree -m --git --level=2 --ignore-glob="node_modules" $argv
end

function lw --wraps='cd (latest_worktree)' --description 'alias lw cd (latest_worktree)'
    cd (latest_worktree) $argv
end

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
abbr gplsys git_pull_system_repos
abbr gf 'git fetch'
abbr gw 'git worktree'
abbr gwa 'git worktree add'
abbr gwr 'git worktree remove'
abbr gwl 'git worktree list'
abbr gau 'git add -u'
abbr gco 'git checkout'
abbr gaa 'git add --all'
abbr gac 'git add --all && ai_commit'
abbr gpo 'git pull origin'
abbr gpor 'git pull origin --rebase'
abbr gdorig 'find . -name \*.orig -delete'
abbr gcm --set-cursor 'git commit -m "%"'
abbr gcmn --set-cursor 'git commit -m "%" --no-verify'
abbr co copy_output
abbr gca 'git commit --amend'
abbr gaic ai_commit # AI-powered Commitizen commit
abbr gmt 'git mergetool'
abbr grhu git_reset_to_upstream
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
abbr wta 'wt switch --create'
abbr wtclean 'wt step prune --min-age=7d --foreground -y'
abbr wtc worktree_clone

# Azure DevOps
abbr atc ado_test_case

# work item extraction
abbr wi workitems_on_date
abbr wid workitems_on_date
abbr wiw workitems_week

# Package manager shortcuts
function dev --wraps='pnpm dev' --description 'alias dev pnpm dev'
    pnpm dev $argv
end

function t --wraps='pnpm test' --description 'alias t pnpm test'
    pnpm test $argv
end

function pr --wraps='pnpm remove' --description 'alias pr pnpm remove'
    pnpm remove $argv
end

function sb --wraps='pnpm storybook' --description 'alias sb pnpm storybook'
    pnpm storybook $argv
end

function sblg --wraps='pnpm exec cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000' --description 'alias sblg pnpm exec cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000'
    pnpm exec cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000 $argv
end

function lint --wraps='pnpm lint' --description 'alias lint pnpm lint'
    pnpm lint $argv
end

function pw --wraps='pnpm -r' --description 'alias pw pnpm -r'
    pnpm -r $argv
end

function pup --wraps='pnpm update --interactive' --description 'alias pup pnpm update --interactive'
    pnpm update --interactive $argv
end

# Weather
function wtr --wraps='curl "wttr.in/Copenhagen?format=%n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n"' --description 'alias wtr curl "wttr.in/Copenhagen?format=%n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n"'
    curl "wttr.in/Copenhagen?format=%n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n" $argv
end
