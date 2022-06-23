# https://github.com/craftzdog/dotfiles-public/blob/master/.config/fish/functions/peco_change_directory.fish
function _peco_change_directory
  if [ (count $argv) ]
    peco --buffer-size=150 --layout=bottom-up --query "$argv "|perl -pe 's/([ ()])/\\\\$1/g'|read foo
  else
    peco --buffer-size=150 --layout=bottom-up |perl -pe 's/([ ()])/\\\\$1/g'|read foo
  end
  if [ $foo ]
        builtin cd $foo
        commandline -r ''
        commandline -f repaint
    else
        commandline -r ''
    end
end

function peco_change_directory
  begin
    echo $HOME/.config
    ghq list -p
    fd --color=never . $HOME/Projects --maxdepth 1 --type d --threads=2
    fd --color=never . $PWD --maxdepth 1 --type d --threads=4
  end | sed -e 's/\/$//g' | awk '!a[$0]++' | _peco_change_directory $argv
end
