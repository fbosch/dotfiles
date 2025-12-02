function install_npm_globals
    set file ~/dotfiles/npm-globals.json
    if not test -f $file
        set_color red
        echo "✗ File $file does not exist."
        set_color normal
        return 1
    end

    set args (jq -r 'to_entries[] | "\(.key)@\(.value)"' $file)
    if test (count $args) -eq 0
        set_color yellow
        echo "  No packages found in $file."
        set_color normal
        return 1
    end

    set_color cyan
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " 󰏗  Installing global npm packages:"
    set_color normal

    for pkg in $args
        set_color green
        echo "  • $pkg"
        set_color normal
    end

    set_color cyan
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    set_color normal

    npm install -g $args

    if test $status -eq 0
        set_color green
        echo "  All packages installed successfully."
    else
        set_color red
        echo "  Error installing one or more packages."
    end
    set_color normal
end
