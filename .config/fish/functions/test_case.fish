function test_case --description 'Get Azure DevOps test case contents by ID, render it, and copy to clipboard'
    # Check if test case ID was provided
    if test (count $argv) -eq 0
        gum style --foreground 1 " Test case ID required"
        gum style --foreground 8 "  Usage: test_case <ID>"
        gum style --foreground 8 "  Example: test_case 50894"
        return 1
    end
    
    set -l test_case_id $argv[1]
    
    # Validate that the ID is a number
    if not string match -qr '^\d+$' $test_case_id
        gum style --foreground 1 " Invalid test case ID: $test_case_id"
        gum style --foreground 8 "  ID must be a number"
        return 1
    end
    
    # Setup cache directory
    set -l cache_dir ~/.cache/azure-devops
    mkdir -p $cache_dir
    set -l cache_file "$cache_dir/test_case_$test_case_id.json"
    
    # Try to detect organization from git config if in a git repo
    set -l org_url ""
    if git rev-parse --git-dir >/dev/null 2>&1
        set -l git_remote (git config --get remote.origin.url 2>/dev/null)
        if string match -qr 'dev\.azure\.com/([^/]+)' $git_remote
            set -l org_name (string match -r 'dev\.azure\.com/([^/]+)' $git_remote | tail -n 1)
            set org_url "https://dev.azure.com/$org_name"
            gum style --foreground 8 " Using organization: $org_name"
        end
    end
    
    # Check cache first
    set -l test_case_json
    if test -f $cache_file
        gum style --foreground 8 " Loading test case #$test_case_id from cache..."
        set test_case_json (cat $cache_file)
    else
        # Fetch the test case using Azure CLI
        gum style --foreground 8 " Fetching test case #$test_case_id..."
        
        if test -n "$org_url"
            set test_case_json (az boards work-item show --id $test_case_id --org $org_url --output json 2>&1)
        else
            set test_case_json (az boards work-item show --id $test_case_id --output json 2>&1)
        end
        
        # Cache the result if successful
        if test $status -eq 0
            printf "%s" "$test_case_json" > $cache_file
        end
    end
    
    if test $status -ne 0
        gum style --foreground 1 " Failed to fetch test case #$test_case_id"
        echo "$test_case_json" | gum style --foreground 8
        return 1
    end
    
    # Extract key fields from the test case
    set -l title (echo $test_case_json | jq -r '.fields."System.Title" // "N/A"')
    set -l state (echo $test_case_json | jq -r '.fields."System.State" // "N/A"')
    set -l assigned_to (echo $test_case_json | jq -r '.fields."System.AssignedTo".displayName // "Unassigned"')
    set -l area_path (echo $test_case_json | jq -r '.fields."System.AreaPath" // "N/A"')
    set -l iteration (echo $test_case_json | jq -r '.fields."System.IterationPath" // "N/A"')
    set -l description_raw (echo $test_case_json | jq -r '.fields."System.Description" // ""')
    set -l steps_raw (echo $test_case_json | jq -r '.fields."Microsoft.VSTS.TCM.Steps" // ""')
    
    # Convert HTML to plain text using html2text
    set -l description ""
    if test -n "$description_raw"
        set description (echo $description_raw | html2text -utf8 -nobs -width 80 | string trim)
    end
    
    # Arrays to collect step data (must be declared before the if block)
    set -l step_actions
    set -l step_expected
    set -l step_actions_md  # For markdown (with escaped pipes)
    set -l step_expected_md  # For markdown (with escaped pipes)
    set -l steps ""
    
    if test -n "$steps_raw"
        # Azure DevOps stores test steps in XML: each <step> has 2 <parameterizedString> elements
        # First = Action (what to do), Second = Expected Result (what should happen)
        # The HTML is XML-encoded (&lt; instead of <)
        
        # Split by </step> to get individual steps
        for step_block in (echo $steps_raw | string replace -a '</step>' '\n===STEP_END===\n' | string split '===STEP_END===')
            if string match -q '*<step*' $step_block
                # Extract both parameterizedString elements from this step
                set -l param_strings (echo $step_block | grep -o '<parameterizedString[^>]*>[^<]*</parameterizedString>')
                
                set -l action ""
                set -l expected ""
                set -l param_count 1
                
                for param_string in $param_strings
                    # Extract content between tags
                    set -l content (echo $param_string | sed -n 's/.*<parameterizedString[^>]*>\(.*\)<\/parameterizedString>.*/\1/p')
                    
                    # Decode XML entities
                    set -l decoded (echo $content | sed 's/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&apos;/'\''/g; s/&amp;/\&/g')
                    
                    # Convert HTML to plain text
                    set -l plain_text (echo $decoded | html2text -utf8 -nobs -width 1000 | string trim)
                    
                    if test $param_count -eq 1
                        set action $plain_text
                    else if test $param_count -eq 2
                        set expected $plain_text
                    end
                    
                    set param_count (math $param_count + 1)
                end
                
                # Add step if action is not empty
                if test -n "$action"
                    # Store raw text for gum display (replace newlines with spaces)
                    set -a step_actions (echo $action | string replace -a \n ' ')
                    set -a step_expected (echo $expected | string replace -a \n ' ')
                    
                    # Store escaped version for markdown
                    set -a step_actions_md (echo $action | string replace -a '|' '\\|' | string replace -a \n ' ')
                    set -a step_expected_md (echo $expected | string replace -a '|' '\\|' | string replace -a \n ' ')
                end
            end
        end
        
        # Build the markdown table using printf for proper newlines
        set steps "| Step | Action | Expected Result |
|------|--------|----------------|"
        
        for i in (seq (count $step_actions_md))
            set steps "$steps
| $i | $step_actions_md[$i] | $step_expected_md[$i] |"
        end
    end
    
    # Build markdown for clipboard
    set -l markdown_output "# Test Case #$test_case_id: $title

## Details
- **State:** $state
- **Assigned To:** $assigned_to
- **Area Path:** $area_path
- **Iteration:** $iteration

## Description
$description

## Test Steps
$steps"
    
    # Render the full markdown using glow
    printf "%s\n" "$markdown_output" | glow -
    
    # Copy to clipboard
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
