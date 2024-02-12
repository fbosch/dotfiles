# Programs
alias nvim 'nvim -n -i NONE'
abbr n 'nvim'
abbr v 'nvim'

abbr bup 'brew upgrade'
alias vimdiff 'nvim -d'
alias snvim 'sudo -E -s nvim' # launch vim in sudo but preserve env config
alias logikill 'ps -ef | grep -i "Logi Options" | grep "Applications" | awk \'{print $2}\' | xargs kill -9' # quickfix for dying logitech driver on M1 Mac
alias wtr 'curl "wttr.in/Copenhagen?format=\n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n"'
alias batbuild 'batch cache --build'

# Directory shortcuts
abbr prj 'cd ~/Projects'

# Helpers
abbr x 'exit'
abbr src 'source ~/.config/fish/config.fish'
abbr makins 'sudo make && sudo make clean install'
abbr cl 'clear'
abbr t 'swpm test'
abbr mki 'sudo make && sudo make clean install'
abbr lk 'logikill'

alias copykey 'pbcopy < ~/.ssh/id_rsa.pub'
alias prettierdstatus 'cat ~/.prettier_d_slim'
alias chrdebug '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222'

# Extended defaults
alias cat 'bat --style=plain --color=always'
alias ls 'eza --icons -F'
alias l 'ls -lh'
alias la 'ls -A'
alias lla 'ls -la'
alias ld 'ls -l --sort=date --ignore-glob="node_modules" -D --time-style=relative'
alias lt 'exa --tree --level=2 --sort=date --ignore-glob="node_modules"'

# Tmux
abbr xtm 'pkill -f tmux'
abbr ntm 'tmux new -s'
abbr atm 'tmux attach-session -t'

# Git
abbr g 'git'
abbr gs 'git status'
abbr gd 'git diff -- . ":!pnpm-lock.yaml" ":!package-lock.json" "!:yarn.lock"'
abbr gp 'git push'
abbr gpl 'git pull'
abbr gf 'git fetch'
abbr gw 'git worktree'
abbr gwa 'git worktree add'
abbr gwr 'git worktree remove'
abbr gwl 'git worktree list'
abbr gau 'git add -u'
abbr gco 'git checkout'
abbr gaa 'git add --all'
abbr gsa 'git stash apply'
abbr gpo 'git pull origin'
abbr gdorig 'find . -name \*.orig -delete'
abbr cm 'aicommits --type conventional -x "pnpm-lock.yaml"'
abbr gcm --set-cursor 'git commit -m "%"'
abbr gca 'git commit --amend --no-edit'
abbr gmt 'git mergetool'
abbr grhh 'git reset --hard HEAD'
abbr gcfd 'git clean -fd'
abbr gbda 'git branch | egrep -v "(master|main|develop|\*)" | xargs git branch -D'
abbr gl 'git log --graph --oneline --decorate'
abbr lg 'lazygit'
abbr bad 'git bisect bad'
abbr good 'git bisect good'

# worktree add
function wta
    set branch_name $argv[1]
    echo $branch_name | worktree-add.sh
    cd -- $branch_name
end

# Webdev
alias scr 'jq -r \'.scripts | to_entries[] | "\(.key):\n \(.value)\n"\' package.json | awk \'BEGIN{idx=1} {print "\033[3"idx"m" $0 "\033[0m"; idx = idx % 3 + 1}\''
alias pnpx 'pnpm dlx'
alias p 'swpm'
alias pa 'swpm add'
alias pr 'swpm remove'
alias pw 'swpm workspace'
alias pup 'spwm update-interactive'
alias t 'spwm tst'
alias dev 'swpm dev'
alias sb 'swpm storybook'
alias sblg 'swpm cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000'
alias lint 'swpm lint'

