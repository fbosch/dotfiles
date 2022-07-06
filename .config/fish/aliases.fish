# Configuration
alias config '/usr/bin/git --git-dir=$HOME/.cfg --work-tree=$HOME'
abbr cfa 'config add'
abbr cfr 'config remove'
abbr cfs 'config status'

# Programs
alias vim 'nvim'
abbr n 'nvim'
abbr v 'nvim'
abbr kssh 'kitty +kitten ssh'
alias snvim 'sudo -E -s nvim' # launch vim in sudo but preserve env config
alias logikill 'kill -9 $(ps ax | grep -E "Logi Options" | head -1 | cut -f 1 -d " ")' # quickfix for dying logitech driver on M1 Mac

# Config Shortcuts
abbr cali 'cat ~/.config/fish/aliases.fish'
abbr cfx 'snvim ~/.xinitrc'
abbr cfish 'nvim ~/.config/fish/config.fish'
abbr cfali 'nvim ~/.config/fish/aliases.fish'
abbr cfx 'snvim ~/.xinitrc'
abbr cfst 'nvim ~/.config/starship.toml'
abbr cfpic 'snvim ~/.config/picom/picom.conf'
abbr cfkit 'nvim ~/.config/kitty/kitty.conf'
abbr cfas 'snvim ~/.local/share/dwm/autostart.sh'
abbr cfvi 'nvim ~/.config/nvim/init.lua'
abbr cfvp 'nvim ~/.config/nvim/lua/plugins.lua'
abbr cftm 'nvim ~/.config/tmux/tmux.conf'
abbr cflf 'nvim ~/.config/lf/lfrc'
abbr cfdu 'nvim ~/.config/dunst/dunstrc'

# Directory shortcuts
abbr prj 'cd ~/Projects' abbr pjo 'pj open '

# Helpers
alias icat 'kitty +kitten icat'
abbr mntnas 'sudo systemctl daemon-reload && sudo mount -a'
abbr src 'source ~/.config/fish/config.fish'
abbr makins 'sudo make && sudo make clean install'
abbr cl 'clear'
abbr t 'yarn test'
abbr mki 'sudo make && sudo make clean install'

# Extended defaults
alias cat 'pygmentize -g -O style=colorful,lineos=1'
alias ls 'exa --icons -F'
alias l 'ls -l'
alias la 'ls -a'
alias lla 'ls -la'
alias lt 'ls --tree'

# Tmux
abbr xtm 'pkill -f tmux'
abbr ntm 'tmux new -s'
abbr atm 'tmux attach-session -t'

# Git
abbr g 'git'
abbr gs 'git status'
abbr gd 'git difftool'
abbr gau 'git add -u'
abbr gco 'git checkout'
abbr gaa 'git add --all'
abbr gcm 'git commit -m "'
abbr grhh 'git reset --hard HEAD'
abbr gcfd 'git clean -fd'

# Webdev
alias ya 'yarn add'
alias yr 'yarn remove'
abbr yt 'yarn test'
abbr yb 'yarn build'
abbr dev 'yarn dev'
abbr sb 'yarn storybook'
abbr lint 'yarn lint'
