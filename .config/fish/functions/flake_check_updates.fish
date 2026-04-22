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
        echo "  FLAKE_CHECK_BATCH_SIZE      (default wrapper value: 3)"
        echo "  FLAKE_CHECK_TIMEOUT_MS      (default wrapper value: 8000)"
        echo "  FLAKE_CHECK_CURSOR          (default wrapper value: 1; set 0 to disable rotation)"
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

    set -l batch_size 3
    set -l timeout_ms 8000
    set -l use_cursor 1

    if set -q FLAKE_CHECK_BATCH_SIZE
        set batch_size "$FLAKE_CHECK_BATCH_SIZE"
    else if set -q FLAKE_CHECK_MAX_INPUTS
        # Backward compatibility for older env name.
        set batch_size "$FLAKE_CHECK_MAX_INPUTS"
    end

    if set -q FLAKE_CHECK_TIMEOUT_MS
        set timeout_ms "$FLAKE_CHECK_TIMEOUT_MS"
    end

    if set -q FLAKE_CHECK_CURSOR
        set use_cursor "$FLAKE_CHECK_CURSOR"
    end

    set -l result (FLAKE_CHECK_BATCH_SIZE="$batch_size" FLAKE_CHECK_TIMEOUT_MS="$timeout_ms" FLAKE_CHECK_CURSOR="$use_cursor" bun --smol --cwd "$libexec_dir" --install=auto "$helper" "$flake_path")
    set -l code $status

    if test -z "$result"
        set result '{"count": 0, "updates": []}'
    end

    echo $result
    return $code
end
