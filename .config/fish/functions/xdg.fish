function xdg -d "Change to an XDG directory"
    set -l location $argv[1]
    set -l directory
    set -l locations bin cache config data state runtime config-dirs data-dirs desktop download templates publicshare documents music pictures videos projects
    set -l variables XDG_BIN_HOME XDG_CACHE_HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_RUNTIME_DIR XDG_CONFIG_DIRS XDG_DATA_DIRS XDG_DESKTOP_DIR XDG_DOWNLOAD_DIR XDG_TEMPLATES_DIR XDG_PUBLICSHARE_DIR XDG_DOCUMENTS_DIR XDG_MUSIC_DIR XDG_PICTURES_DIR XDG_VIDEOS_DIR XDG_PROJECTS_DIR

    if test -z "$location"
        if not command -v gum >/dev/null
            echo "gum is required to select an XDG directory" >&2
            return 1
        end

        set -l available
        for index in (seq (count $locations))
            if set -q $variables[$index]
                set -a available $locations[$index]
            end
        end

        set location (printf '%s\n' $available | gum filter --header="Search XDG directories")
        if test -z "$location"
            return 0
        end
    end

    set -l index (contains -i -- $location $locations)
    if test -z "$index"
        echo "Unknown XDG directory: $location" >&2
        return 2
    end

    set -l variable $variables[$index]
    if not set -q $variable
        echo "$variable is not set" >&2
        return 1
    end

    set directory $$variable
    if string match -q '*-dirs' -- $location
        if not command -v gum >/dev/null
            echo "gum is required to select an XDG directory" >&2
            return 1
        end

        set directory (string split : -- "$directory" | gum filter --header="Search $variable")
        if test -z "$directory"
            return 0
        end
    end

    cd "$directory"
end
