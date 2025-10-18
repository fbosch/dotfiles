# Neovim
alias nvim 'nvim -n -i NONE --noplugin'
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

function vimdiff
    nvim -d $argv
end

function snvim
    sudo -E -s nvim $argv
end

function wtr
    curl "wttr.in/Copenhagen?format=%n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n"
end

function batbuild
    bat cache --build $argv
end

function bat_fast
    bat --style=plain --color=never --wrap=never --paging=never $argv
end

function copykey
    pbcopy <~/.ssh/id_rsa.pub
end

alias uge get_week_dates
alias rw remaining_work_hours

# Directory shortcuts - fingers too fast for accuracy ⚡
abbr prj 'cd ~/Projects'
abbr pjr 'cd ~/Projects'
abbr rpj 'cd ~/Projects'

abbr cf 'cd ~/.config'
abbr cnx 'cd /etc/nixos'
abbr nxe 'nvim ~/nixos'
abbr nxrb 'sudo nixos-rebuild switch --flake ~/nixos'
abbr nxgc nix-collect-garbage

# Helpers
abbr x exit
abbr src 'source ~/.config/fish/config.fish'
abbr makins 'sudo make && sudo make clean install'
abbr cl clear
abbr t 'swpm test'
abbr mki 'sudo make && sudo make clean install'

# Extended defaults
function cat
    bat --style=plain --color=always $argv
end
function ls
    eza --icons -F $argv
end
function l
    ls -lh $argv
end
function la
    ls -A $argv
end
function lla
    ls -la $argv
end
function ld
    ls -l --sort=date --ignore-glob="node_modules" -D --time-style=relative $argv
end
function lt
    eza --tree -m --git --level=2 --ignore-glob="node_modules" $argv
end

alias lw 'cd (latest_worktree)'

# Tmux
abbr xtm 'pkill -f tmux'
abbr ntm 'tmux new -s'
abbr atm 'tmux attach-session -t'

# Git
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
# abbr gsa 'git stash apply'
abbr gpo 'git pull origin'
abbr gpor 'git pull origin --rebase'
abbr gdorig 'find . -name \*.orig -delete'
abbr cm 'aicommits --type conventional -x "pnpm-lock.yaml"'
abbr gcm --set-cursor 'git commit -m "%"'
abbr gcmn --set-cursor 'git commit -m "%" --no-verify'
abbr gca 'git commit --amend --no-edit'
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

function src
    jq -r \'.scripts | to_entries[] | "\(.key):\n \(.value)\n"\' package.json | awk \'BEGIN{idx=1} {print "\033[3"idx"m" $0 "\033[0m"; idx = idx % 3 + 1}\'
end

# Webdev
function pnpx
    pnpm dlx $argv
end
function p
    swpm $argv
end
function pa
    swpm add $argv
end
function pr
    swpm remove $argv
end
function pw
    swpm workspace $argv
end
function pup
    spwm update-interactive $argv
end
function t
    spwm tst $argv
end
function dev
    swpm dev $argv
end
function sb
    swpm storybook $argv
end
function sblg
    swpm cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000 $argv
end
function lint
    swpm lint $argv
end
