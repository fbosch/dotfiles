function nxrb
    if command -q nh
        nh os switch ~/nixos
    else
        set -l host (hostname)
        sudo nixos-rebuild switch --flake ~/nixos\#$host
    end
end
