function ai_commit_test --description 'Test ai_commit dry-run and model override'
    # Check if we have staged changes
    if not git diff --cached --quiet
        gum style --foreground 6 "✓ Found staged changes - testing with real diff"
    else
        gum style --foreground 3 "⚠ No staged changes - creating test scenario"
        
        # Create a test file
        set -l test_file ".ai_commit_test_$(date +%s).tmp"
        echo "function test_feature
    echo 'new feature'
end" > $test_file
        git add $test_file
        
        gum style --foreground 6 "✓ Staged test file: $test_file"
    end
    
    echo ""
    gum style --border rounded --padding "1 2" --foreground 5 "🧪 Test 1: Dry Run with Default Model"
    echo ""
    
    # Test 1: Dry run with default model
    fish -c 'source .config/fish/functions/ai_commit.fish; ai_commit --dry' < /dev/null
    
    echo ""
    echo ""
    gum style --border rounded --padding "1 2" --foreground 5 "🧪 Test 2: Dry Run with GPT-4o Override"
    echo ""
    
    # Test 2: Dry run with model override
    fish -c 'source .config/fish/functions/ai_commit.fish; ai_commit --dry --model github-copilot/gpt-4o' < /dev/null
    
    echo ""
    gum style --foreground 2 "✓ Tests complete!"
    
    # Cleanup if we created a test file
    if test -f .ai_commit_test_*.tmp
        git reset HEAD .ai_commit_test_*.tmp 2>/dev/null
        rm -f .ai_commit_test_*.tmp
        gum style --foreground 8 "✓ Cleaned up test files"
    end
end
