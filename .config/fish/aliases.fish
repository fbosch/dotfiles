# Configuration
alias config '/usr/bin/git --git-dir=$HOME/.cfg --work-tree=$HOME'
abbr cfa 'config add'
abbr cfr 'config remove'
abbr cfs 'config status'

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
abbr cfvi 'nvim ~/.config/nvim/init.vim'
abbr cfvp 'nvim ~/.config/nvim/lua/plugins.lua'
abbr cftm 'nvim ~/.config/tmux/tmux.conf'
abbr cflf 'nvim ~/.config/lf/lfrc'
abbr cfdu 'nvim ~/.config/dunst/dunstrc'

# Directory shortcuts
abbr prj 'cd ~/Projects'
abbr pjo 'pj open '

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
abbr gau 'git add -u'
abbr gco 'git checkout'
abbr gaa 'git add --all'
abbr cm 'commit -m ""'

# Webdev
alias ya 'yarn add'
alias yr 'yarn remove'
abbr dev 'yarn dev'
abbr sb 'yarn storybook'

# Programs
alias vim 'nvim'
abbr v 'nvim'
abbr kssh 'kitty +kitten ssh'
alias snvim 'sudo -E -s nvim' # launch vim in sudo but preserve env config
alias logikill 'kill -9 $(ps ax | grep -E "Logi Options" | head -1 | cut -f 1 -d " ")'
