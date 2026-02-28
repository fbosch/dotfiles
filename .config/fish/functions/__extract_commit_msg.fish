function __extract_commit_msg --description 'Extract and sanitize a conventional commit message from raw AI output'
    # Accepts raw AI text as $argv[1] (already ANSI-stripped, from jq extraction)
    set -l raw $argv[1]

    # Strip backtick code fences and trim
    set -l cleaned (echo "$raw" | sed 's/```[a-z]*//g' | string trim)

    set -l commit_msg ""
    for line in (echo "$cleaned" | string split "\n")
        test -z "$line"; and continue
        # Strip common label prefixes models emit before the message
        set line (string replace -r '^\*{0,2}(Commit [Mm]essage|COMMIT MESSAGE):\*{0,2}\s*' '' -- "$line")
        set line (string trim -- "$line")
        test -z "$line"; and continue
        if string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: \S' -- "$line"
            set commit_msg "$line"
            break
        end
    end

    # Fallback: first non-empty line after label stripping
    if test -z "$commit_msg"
        for line in (echo "$cleaned" | string split "\n")
            set line (string replace -r '^\*{0,2}(Commit [Mm]essage|COMMIT MESSAGE):\*{0,2}\s*' '' -- "$line")
            set line (string trim -- "$line")
            test -z "$line"; and continue
            set commit_msg "$line"
            break
        end
    end

    # Strip trailing period
    set commit_msg (string replace -r '\.$' '' -- "$commit_msg")

    echo "$commit_msg"
end
