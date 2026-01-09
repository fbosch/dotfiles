function nxrb
    switch (uname)
        case Darwin
            if command -q nh
                nh darwin switch . -H rvn-mac
            else
                darwin-rebuild switch --flake ~/nixos\#rvn-mac
            end
        case Linux
            if command -q nh
                nh os switch ~/nixos
            else
                set -l host (hostname)
                sudo nixos-rebuild switch --flake ~/nixos\#$host
            end
    end
end
