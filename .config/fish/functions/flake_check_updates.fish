function flake_check_updates --description 'Check for available flake updates and return JSON with details'
    set -l options h/help
    argparse -n flake_check_updates $options -- $argv
    or begin
        echo '{"count": 0, "updates": []}'
        return 1
    end

    if set -q _flag_help
        echo "Usage: flake_check_updates [FLAKE_PATH]"
        echo "Env overrides:"
        echo "  FLAKE_CHECK_MAX_INPUTS      (default wrapper value: 10)"
        return 0
    end

    if not command -q bun
        echo "flake_check_updates: bun not found" >&2
        echo '{"count": 0, "updates": []}'
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "flake_check_updates.ts"

    if not test -f "$libexec_dir/$helper"
        echo "flake_check_updates: helper not found: $libexec_dir/$helper" >&2
        echo '{"count": 0, "updates": []}'
        return 1
    end

    set -l flake_path $argv[1]
    if test -z "$flake_path"
        set flake_path ~/nixos
    end

    set -l max_inputs 10

    if set -q FLAKE_CHECK_MAX_INPUTS
        set max_inputs "$FLAKE_CHECK_MAX_INPUTS"
    end

    set -l result (FLAKE_CHECK_MAX_INPUTS="$max_inputs" bun --smol --cwd "$libexec_dir" --install=auto "$helper" "$flake_path")
    set -l code $status

    if test -z "$result"
        set result '{"count": 0, "updates": []}'
    end

    echo $result
    return $code
end
