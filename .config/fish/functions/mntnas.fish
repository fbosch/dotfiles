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
