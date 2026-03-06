function wt
    set -l use_source false
    set -l args

    for arg in $argv
        if test "$arg" = --source
            set use_source true
        else
            set -a args $arg
        end
    end

    test -n "$WORKTRUNK_BIN"; or set -l WORKTRUNK_BIN (type -P wt 2>/dev/null)
    if test -z "$WORKTRUNK_BIN"
        echo "wt: command not found" >&2
        return 127
    end
    set -l directive_file (mktemp)

    # --source: use cargo run (builds from source)
    if test $use_source = true
        env WORKTRUNK_DIRECTIVE_FILE=$directive_file cargo run --bin wt --quiet -- $args
    else
        env WORKTRUNK_DIRECTIVE_FILE=$directive_file $WORKTRUNK_BIN $args
    end
    set -l exit_code $status

    if test -s "$directive_file"
        source "$directive_file"
        if test $exit_code -eq 0
            set exit_code $status
        end
    end

    rm -f "$directive_file"
    return $exit_code
end
