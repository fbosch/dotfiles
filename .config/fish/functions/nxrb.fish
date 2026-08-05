function nxrb
    if not set -q NH_FLAKE
        echo "NH_FLAKE is not set"
        return 1
    end

    set -l flake "$NH_FLAKE"

    switch (uname)
        case Darwin
            if not set -q NH_DARWIN_HOST
                echo "NH_DARWIN_HOST is not set"
                return 1
            end

            if command -q nh
                nh darwin switch "$flake" -H "$NH_DARWIN_HOST" --accept-flake-config
            else
                darwin-rebuild switch --flake "$flake#$NH_DARWIN_HOST" --option accept-flake-config true
            end
        case Linux
            if command -q nh
                nh os switch "$flake"
            else
                set -l host (hostname)
                sudo nixos-rebuild switch --flake "$flake#$host"
            end
    end
end
