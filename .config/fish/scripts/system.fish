# System utilities and npm global helpers

function mntnas
    if test (uname) = Darwin
        osascript -e 'mount volume "smb://100.86.100.78"'
        return 0
    end

    if test (uname) = Linux
        set share (gum input --placeholder="Shared Folder" --prompt="󰉌 ")
        if test -z "$share"
            echo "No share provided."
            return 1
        end
        set user (whoami)
        set mount_point /mnt/nas
        if not test -d $mount_point
            sudo mkdir -p $mount_point
        end
        set uid (id -u)
        set gid (id -g)
        sudo mount -t cifs "//192.168.1.2/$share" $mount_point -o user=$user,uid=$uid,gid=$gid
        cd /mnt/nas
    end
end

function disk_space
    df -h / | awk 'NR==2 {print "Total: " $2 "\nUsed: " $3 "\nAvailable: " $4 "\nPercentage Used: " $5}'
end

function export_npm_globals
    set old_file ~/dotfiles/npm-globals.json.bak
    set new_file ~/dotfiles/npm-globals.json

    if test -f $new_file
        mv $new_file $old_file
    end

    # Exclude 'npm' itself from export
    npm list -g --depth=0 --json | jq 'del(.dependencies.npm) | .dependencies | map_values(.version)' >$new_file

    if test -f $old_file
        echo "Diff (old vs new):"
        difft $old_file $new_file
    else
        echo "No previous npm-globals.json found, exported current global packages."
        cat $new_file
    end
end

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
