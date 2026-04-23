function ado_test_case --description 'Get Azure DevOps test case contents by ID, render it, and copy to clipboard'
    if test (count $argv) -eq 0
        gum style --foreground 1 " Test case ID required"
        gum style --foreground 8 "  Usage: ado_test_case <ID>"
        gum style --foreground 8 "  Example: ado_test_case 50894"
        return 1
    end

    set -l test_case_id $argv[1]
    if not string match -qr '^\d+$' $test_case_id
        gum style --foreground 1 " Invalid test case ID: $test_case_id"
        gum style --foreground 8 "  ID must be a number"
        return 1
    end

    if not command -q bun
        gum style --foreground 1 " bun is required"
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "azure/ado_test_case_helper.ts"

    if not test -f "$libexec_dir/$helper"
        gum style --foreground 1 " helper not found: $libexec_dir/$helper"
        return 1
    end

    set -l org_url ""
    if git rev-parse --git-dir >/dev/null 2>&1
        set -l git_remote (git config --get remote.origin.url 2>/dev/null)
        if string match -qr 'dev\.azure\.com/([^/]+)' $git_remote
            set -l org_name (string match -r 'dev\.azure\.com/([^/]+)' $git_remote | tail -n 1)
            set org_url "https://dev.azure.com/$org_name"
            gum style --foreground 8 " Using organization: $org_name"
        end
    end

    set -l cache_dir /tmp/azure-devops-cache
    set -l markdown_output

    if test -n "$org_url"
        set markdown_output (ADO_TEST_CASE_ORG_URL="$org_url" ADO_TEST_CASE_CACHE_DIR="$cache_dir" bun --cwd "$libexec_dir" --install=auto "$helper" "$test_case_id")
    else
        set markdown_output (ADO_TEST_CASE_CACHE_DIR="$cache_dir" bun --cwd "$libexec_dir" --install=auto "$helper" "$test_case_id")
    end

    if test $status -ne 0
        gum style --foreground 1 " Failed to fetch test case #$test_case_id"
        return 1
    end

    printf "%s\n" "$markdown_output" | glow -s "$HOME/.config/glow/zenwritten-dark.json" -

    set -l clipboard_cmd ""
    if test (uname) = Darwin
        set clipboard_cmd pbcopy
    else if test (uname) = Linux
        if command -v wl-copy >/dev/null 2>&1
            set clipboard_cmd wl-copy
        else if command -v xclip >/dev/null 2>&1
            set clipboard_cmd "xclip -selection clipboard"
        end
    end

    if test -n "$clipboard_cmd"
        echo -n "$markdown_output" | eval $clipboard_cmd
        if test $status -eq 0
            echo ""
            gum style --foreground 2 "󰸞 Test case copied to clipboard"
        else
            gum style --foreground 3 "󰦨 Failed to copy to clipboard"
        end
    else
        gum style --foreground 3 "󰦨 Clipboard command not found"
    end
end
